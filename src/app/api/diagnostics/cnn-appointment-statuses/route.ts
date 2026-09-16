import { NextResponse } from "next/server";
import { ClinicaNasNuvensClient, ClinicaNasNuvensApiError } from "@/lib/integrations/clinica-nas-nuvens/client";
import { getIntegrationStatus } from "@/lib/integrations/service";
import { todayPlusDaysIso } from "@/lib/report/today";

/**
 * TEMPORARY diagnostic route — delete once the real Clínica nas Nuvens
 * `status` vocabulary (which string means "no-show" vs "cancelado" vs
 * "confirmado", etc.) is confirmed and encoded in src/lib/report/daily-agenda.ts.
 * Lists distinct status values seen in appointments over a date window,
 * with one example appointment id per status.
 *
 * Query params: from/to (YYYY-MM-DD), default to the last 30 days through
 * 7 days from now.
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

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? todayPlusDaysIso(-30);
  const to = url.searchParams.get("to") ?? todayPlusDaysIso(7);

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const appointments = await client.listAppointments(from, to);

    const byStatus = new Map<string, { count: number; exampleId: number; exampleDate: string }>();
    for (const appointment of appointments) {
      const existing = byStatus.get(appointment.status);
      if (existing) {
        existing.count += 1;
      } else {
        byStatus.set(appointment.status, { count: 1, exampleId: appointment.id, exampleDate: appointment.data });
      }
    }

    return NextResponse.json({
      from,
      to,
      totalAppointments: appointments.length,
      statuses: Object.fromEntries(byStatus),
    });
  } catch (err) {
    if (err instanceof ClinicaNasNuvensApiError) {
      return NextResponse.json({ error: err.message, status: err.status, body: err.body }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
