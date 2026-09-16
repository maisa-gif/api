import { NextResponse } from "next/server";
import { getClinicaNasNuvensEnvConfig, ClinicaNasNuvensConfigError } from "@/lib/integrations/clinica-nas-nuvens/config";
import { getIntegrationStatus } from "@/lib/integrations/service";

/**
 * TEMPORARY diagnostic route — delete once the /executor-agenda/lista
 * response shape (how to map idPessoaExecutor to a professional's name) is
 * confirmed and used in src/lib/report/daily-agenda.ts. Calls the raw
 * endpoint directly (bypassing ClinicaNasNuvensClient, which doesn't
 * expose this endpoint) and returns the unmodified response body.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return NextResponse.json({ error: "Clínica nas Nuvens is disabled or missing its token/hash." }, { status: 400 });
  }

  try {
    const { baseUrl, clientId, clientSecret } = getClinicaNasNuvensEnvConfig();
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const response = await fetch(`${baseUrl}/executor-agenda/lista`, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "clinicaNasNuvens-cid": cnnStatus.token,
      },
    });

    const body = await response.json().catch(() => null);
    return NextResponse.json({ status: response.status, body }, { status: response.ok ? 200 : 502 });
  } catch (err) {
    if (err instanceof ClinicaNasNuvensConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
