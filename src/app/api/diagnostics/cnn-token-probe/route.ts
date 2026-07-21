import { NextResponse } from "next/server";
import { getClinicaNasNuvensEnvConfig } from "@/lib/integrations/clinica-nas-nuvens/config";
import { getIntegrationStatus } from "@/lib/integrations/service";

/**
 * TEMPORARY diagnostic route — delete once the real CNN API surface is
 * confirmed and hardcoded back into
 * src/lib/integrations/clinica-nas-nuvens/client.ts.
 *
 * Previous rounds (removed): guessed ~28 paths (404), found /v2/api-docs
 * exposes the full Swagger 2.0 spec unauthenticated, extracted the real
 * route list (GET /agenda/lista is the real appointments endpoint, no
 * dedicated token-issuing route exists) and then the parameters/response
 * shape for the endpoints we need. dataInicial/dataFinal are required
 * query params on /agenda/lista but are typed as plain "string" in the
 * spec with no format, so this round makes a real call with both a
 * plausible ISO and a Brazilian date format to see which one the server
 * actually accepts, and what a real response payload looks like.
 */
function formatIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatBr(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { baseUrl, clientId, clientSecret } = getClinicaNasNuvensEnvConfig();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  const cid = cnnStatus.token ?? "";

  const from = new Date();
  const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const dateFormats = [
    { label: "iso", dataInicial: formatIso(from), dataFinal: formatIso(to) },
    { label: "br", dataInicial: formatBr(from), dataFinal: formatBr(to) },
  ];

  const results = await Promise.all(
    dateFormats.map(async ({ label, dataInicial, dataFinal }) => {
      const params = new URLSearchParams({ dataInicial, dataFinal, registrosPorPagina: "5" });
      try {
        const response = await fetch(`${baseUrl}/agenda/lista?${params.toString()}`, {
          method: "GET",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "clinicaNasNuvens-cid": cid,
          },
        });
        const bodyText = await response.text();
        return { label, dataInicial, dataFinal, status: response.status, body: bodyText.slice(0, 2000) };
      } catch (err) {
        return {
          label,
          dataInicial,
          dataFinal,
          status: null,
          body: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return NextResponse.json({ cidConfigured: Boolean(cid), results });
}
