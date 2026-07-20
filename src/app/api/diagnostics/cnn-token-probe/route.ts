import { NextResponse } from "next/server";
import { getClinicaNasNuvensEnvConfig } from "@/lib/integrations/clinica-nas-nuvens/config";

/**
 * TEMPORARY diagnostic route — delete once the real CNN token endpoint
 * path is confirmed and hardcoded back in
 * src/lib/integrations/clinica-nas-nuvens/client.ts. `/oauth/token`
 * 404'd in production even with valid Basic-auth credentials, so this
 * tries a curated list of common Spring/OAuth2 token endpoint paths
 * using those same (already-configured) credentials and reports how
 * each one responded.
 */
const CANDIDATE_PATHS = [
  "/oauth/token",
  "/api/oauth/token",
  "/oauth2/token",
  "/api/oauth2/token",
  "/auth/token",
  "/api/auth/token",
  "/api/v1/oauth/token",
  "/v1/oauth/token",
  "/login",
  "/api/login",
  "/token",
  "/api/token",
  "/authenticate",
  "/api/authenticate",
  "/api/v1/auth/token",
];

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

  const results = await Promise.all(
    CANDIDATE_PATHS.map(async (path) => {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basicAuth}`,
          },
          body: new URLSearchParams({ grant_type: "client_credentials" }),
        });
        const bodyText = await response.text();
        return { path, status: response.status, body: bodyText.slice(0, 500) };
      } catch (err) {
        return { path, status: null, body: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  return NextResponse.json({ baseUrl, results });
}
