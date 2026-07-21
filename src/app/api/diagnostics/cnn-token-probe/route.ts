import { NextResponse } from "next/server";
import { getClinicaNasNuvensEnvConfig } from "@/lib/integrations/clinica-nas-nuvens/config";

/**
 * TEMPORARY diagnostic route — delete once the real CNN API surface is
 * confirmed and hardcoded back into
 * src/lib/integrations/clinica-nas-nuvens/client.ts.
 *
 * Round 1: ~15 common OAuth2 token endpoint path guesses — all 404.
 * Round 2: ~13 common agenda/appointments resource path guesses with
 * direct Basic auth — all 404.
 *
 * Round 3 (this version): instead of guessing more individual paths,
 * check whether the API exposes a Spring Boot OpenAPI/Swagger spec
 * (springdoc or springfox), which would list every real route/method
 * authoritatively in one response instead of more blind guesses.
 */
const CANDIDATE_SPEC_PATHS = [
  "/v3/api-docs",
  "/v3/api-docs.yaml",
  "/api-docs",
  "/v2/api-docs",
  "/swagger.json",
  "/swagger.yaml",
  "/openapi.json",
  "/openapi.yaml",
  "/swagger-ui/index.html",
  "/swagger-ui.html",
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
    CANDIDATE_SPEC_PATHS.map(async (path) => {
      // Try both unauthenticated and with Basic auth — spec endpoints are
      // often (but not always) left public.
      const attempts = await Promise.all(
        [
          { label: "no-auth", headers: {} as Record<string, string> },
          { label: "basic-auth", headers: { Authorization: `Basic ${basicAuth}` } },
        ].map(async ({ label, headers }) => {
          try {
            const response = await fetch(`${baseUrl}${path}`, { method: "GET", headers });
            const bodyText = await response.text();
            return { label, status: response.status, bodyPreview: bodyText.slice(0, 300) };
          } catch (err) {
            return { label, status: null, bodyPreview: err instanceof Error ? err.message : String(err) };
          }
        })
      );
      return { path, attempts };
    })
  );

  return NextResponse.json({ baseUrl, results });
}
