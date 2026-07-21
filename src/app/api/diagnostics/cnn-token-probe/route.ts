import { NextResponse } from "next/server";
import { getClinicaNasNuvensEnvConfig } from "@/lib/integrations/clinica-nas-nuvens/config";

/**
 * TEMPORARY diagnostic route — delete once the real CNN API surface is
 * confirmed and hardcoded back into
 * src/lib/integrations/clinica-nas-nuvens/client.ts.
 *
 * Previous rounds (removed): guessed ~28 individual endpoint paths (all
 * 404), then discovered /v2/api-docs exposes the full Springfox Swagger
 * 2.0 spec unauthenticated, then extracted the full route list from it —
 * GET /agenda/lista is the real appointments endpoint, and there's no
 * separate token-issuing route in the spec (GET /info describes fetching
 * info about an existing token instead), suggesting auth is direct Basic
 * auth per request rather than an OAuth2 client_credentials exchange.
 *
 * This version drills into the spec for the handful of operations we
 * actually need — parameters + response shape — so the client can be
 * fixed in one pass instead of more guessing.
 */
interface SwaggerParam {
  name: string;
  in: string;
  required?: boolean;
  type?: string;
  description?: string;
}

interface SwaggerOperation {
  summary?: string;
  parameters?: SwaggerParam[];
  responses?: Record<string, { schema?: SwaggerSchemaRef }>;
}

interface SwaggerSchemaRef {
  $ref?: string;
  type?: string;
  items?: SwaggerSchemaRef;
}

interface SwaggerDefinition {
  properties?: Record<string, { type?: string; format?: string; description?: string }>;
}

interface SwaggerV2Spec {
  basePath?: string;
  paths?: Record<string, Record<string, SwaggerOperation>>;
  definitions?: Record<string, SwaggerDefinition>;
}

function resolveSchema(schema: SwaggerSchemaRef | undefined, spec: SwaggerV2Spec) {
  if (!schema) return null;
  const ref = schema.$ref ?? schema.items?.$ref;
  if (!ref) return { raw: schema };
  const defName = ref.replace("#/definitions/", "");
  const def = spec.definitions?.[defName];
  return {
    definition: defName,
    properties: def?.properties
      ? Object.fromEntries(
          Object.entries(def.properties).map(([name, p]) => [name, p.format ?? p.type ?? "unknown"])
        )
      : null,
  };
}

const TARGETS: Array<{ path: string; method: string }> = [
  { path: "/agenda/lista", method: "get" },
  { path: "/agenda/{id}", method: "get" },
  { path: "/agenda/{id}/resumida", method: "get" },
  { path: "/info", method: "get" },
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

  const { baseUrl } = getClinicaNasNuvensEnvConfig();
  const response = await fetch(`${baseUrl}/v2/api-docs`);
  if (!response.ok) {
    return NextResponse.json(
      { error: `/v2/api-docs returned ${response.status}` },
      { status: 502 }
    );
  }

  const spec = (await response.json()) as SwaggerV2Spec;

  const details = TARGETS.map(({ path, method }) => {
    const op = spec.paths?.[path]?.[method];
    if (!op) return { path, method, found: false };

    return {
      path,
      method,
      found: true,
      summary: op.summary ?? null,
      parameters: (op.parameters ?? []).map((p) => ({
        name: p.name,
        in: p.in,
        required: Boolean(p.required),
        type: p.type ?? null,
        description: p.description ?? null,
      })),
      response200: resolveSchema(op.responses?.["200"]?.schema, spec),
    };
  });

  return NextResponse.json({ basePath: spec.basePath ?? null, details });
}
