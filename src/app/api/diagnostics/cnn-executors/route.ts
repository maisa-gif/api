import { NextResponse } from "next/server";
import { ClinicaNasNuvensClient } from "@/lib/integrations/clinica-nas-nuvens/client";
import { getIntegrationStatus } from "@/lib/integrations/service";

/**
 * TEMPORARY diagnostic route — delete once Dr. Luis Eduardo's
 * codigoPessoaExecutor is confirmed and wired into the sync job as a
 * filter. Dumps the raw GET /executor-agenda/lista response since its
 * shape isn't confirmed yet.
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
    return NextResponse.json(
      { error: "Clínica nas Nuvens integration is disabled or missing its token/hash." },
      { status: 400 }
    );
  }

  const client = new ClinicaNasNuvensClient(cnnStatus.token);

  try {
    const executors = await client.listExecutors();
    return NextResponse.json({ executors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
