import { NextResponse } from "next/server";
import {
  ClinicaNasNuvensApiError,
  ClinicaNasNuvensClient,
} from "@/lib/integrations/clinica-nas-nuvens/client";
import { GoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { getIntegrationStatus } from "@/lib/integrations/service";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY one-time cleanup route — delete after running once.
 *
 * CLINICA_NAS_NUVENS_EXECUTOR_ID was added after the sync had already
 * pushed every professional's appointments to Google Calendar, so this
 * removes the previously-synced events that don't belong to that
 * professional (both the Google Calendar event and the SyncedAppointment
 * tracking row), leaving only their appointments going forward.
 */
// Raise past the Hobby-plan default 10s — 100+ sequential CNN calls can
// take a while.
export const maxDuration = 60;

function describeError(err: unknown): string {
  if (err instanceof ClinicaNasNuvensApiError) {
    return `${err.message} (status ${err.status}, body: ${JSON.stringify(err.body)})`;
  }
  return err instanceof Error ? err.message : String(err);
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

  const executorId = process.env.CLINICA_NAS_NUVENS_EXECUTOR_ID
    ? Number(process.env.CLINICA_NAS_NUVENS_EXECUTOR_ID)
    : undefined;
  if (executorId === undefined) {
    return NextResponse.json(
      { error: "CLINICA_NAS_NUVENS_EXECUTOR_ID is not configured" },
      { status: 400 }
    );
  }

  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return NextResponse.json(
      { error: "Clínica nas Nuvens integration is disabled or missing its token/hash." },
      { status: 400 }
    );
  }

  const cnnClient = new ClinicaNasNuvensClient(cnnStatus.token);
  const googleClient = new GoogleCalendarClient();

  const synced = await prisma.syncedAppointment.findMany();
  let removed = 0;
  let kept = 0;
  const errors: string[] = [];

  for (const row of synced) {
    try {
      const appointment = await cnnClient.getAppointment(Number(row.cnnAppointmentId));
      if (appointment.idPessoaExecutor === executorId) {
        kept += 1;
        continue;
      }

      await googleClient.deleteEvent(row.googleCalendarId, row.googleEventId);
      await prisma.syncedAppointment.delete({ where: { id: row.id } });
      removed += 1;
    } catch (err) {
      errors.push(`Appointment ${row.cnnAppointmentId}: ${describeError(err)}`);
    }
  }

  return NextResponse.json({ removed, kept, errors });
}
