import { NextResponse } from "next/server";
import { getClinicaNasNuvensEnvConfig } from "@/lib/integrations/clinica-nas-nuvens/config";
import { getIntegrationStatus } from "@/lib/integrations/service";

/**
 * TEMPORARY diagnostic route — delete once the real CNN agenda endpoint
 * (path + auth flow) is confirmed and hardcoded back into
 * src/lib/integrations/clinica-nas-nuvens/client.ts.
 *
 * Round 1 (token-exchange hypothesis, since removed): tried ~15 common
 * OAuth2 token endpoint paths — all 404'd "Not Found", even though the
 * same Basic-auth credentials are accepted (no more "Bad credentials")
 * once a real path is hit. Combined with the API returning a generic
 * Spring Security "Full authentication is required" 403 for basically
 * any unauthenticated request, that suggests there may be no separate
 * token-exchange step at all.
 *
 * Round 2 (this version): tests the simpler hypothesis that resource
 * endpoints accept HTTP Basic auth directly — client_id:client_secret
 * as Basic credentials, plus the clinicaNasNuvens-cid header carrying
 * the per-account token — with no token exchange beforehand.
 */
const CANDIDATE_RESOURCE_PATHS = [
  "/agenda",
  "/api/agenda",
  "/agendamentos",
  "/api/agendamentos",
  "/consultas",
  "/api/consultas",
  "/api/v1/agenda",
  "/v1/agenda",
  "/schedule",
  "/api/schedule",
  "/appointments",
  "/api/appointments",
  "/api/v1/agendamentos",
];

const CID_HEADER = "clinicaNasNuvens-cid";

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

  const results = await Promise.all(
    CANDIDATE_RESOURCE_PATHS.map(async (path) => {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "GET",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            [CID_HEADER]: cid,
          },
        });
        const bodyText = await response.text();
        return { path, status: response.status, body: bodyText.slice(0, 500) };
      } catch (err) {
        return { path, status: null, body: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  return NextResponse.json({ baseUrl, cidConfigured: Boolean(cid), results });
}
