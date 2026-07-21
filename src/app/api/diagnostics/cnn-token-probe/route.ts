import { NextResponse } from "next/server";
import { getClinicaNasNuvensEnvConfig } from "@/lib/integrations/clinica-nas-nuvens/config";

/**
 * TEMPORARY diagnostic route — delete once the real CNN API surface is
 * confirmed and hardcoded back into
 * src/lib/integrations/clinica-nas-nuvens/client.ts.
 *
 * Rounds 1-2 (removed): guessed ~28 individual endpoint paths, all 404.
 * Round 3 (removed): found that /v2/api-docs returns a full Swagger 2.0
 * spec (Springfox 2.9.2), unauthenticated.
 *
 * This version fetches that spec and returns a condensed summary
 * (basePath + every real path/method/summary) instead of guessing —
 * the spec is the authoritative source, no more guessing needed.
 */
interface SwaggerV2Spec {
  basePath?: string;
  paths?: Record<string, Record<string, { summary?: string; operationId?: string }>>;
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

  const { baseUrl } = getClinicaNasNuvensEnvConfig();

  const response = await fetch(`${baseUrl}/v2/api-docs`);
  if (!response.ok) {
    return NextResponse.json(
      { error: `/v2/api-docs returned ${response.status}`, body: await response.text() },
      { status: 502 }
    );
  }

  const spec = (await response.json()) as SwaggerV2Spec;

  const routes = Object.entries(spec.paths ?? {}).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({
      method: method.toUpperCase(),
      path,
      summary: op.summary ?? op.operationId ?? null,
    }))
  );

  return NextResponse.json({ basePath: spec.basePath ?? null, routeCount: routes.length, routes });
}
