import { NextResponse } from "next/server";
import { ClinicaNasNuvensClient } from "@/lib/integrations/clinica-nas-nuvens/client";
import { GoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { getIntegrationStatus } from "@/lib/integrations/service";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route — delete once it's clear why some
 * rescheduled patients (Ricardo Businaro, Ricardo Souza, Ronaldo
 * Marcilio) still show on today's Google Calendar. Searches CNN
 * appointments across a wide window (-14 to +30 days) matching the given
 * names, and cross-references each match's SyncedAppointment row +
 * current Google Calendar event date.
 */
export const maxDuration = 60;

const EXECUTOR_ID = process.env.CLINICA_NAS_NUVENS_EXECUTOR_ID
  ? Number(process.env.CLINICA_NAS_NUVENS_EXECUTOR_ID)
  : undefined;

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
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

  const namesParam = new URL(request.url).searchParams.get("names") ?? "";
  const targetNames = namesParam
    .split(",")
    .map((n) => normalizeName(n))
    .filter(Boolean);

  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return NextResponse.json({ error: "CNN integration disabled/missing token" }, { status: 500 });
  }
  const cnnClient = new ClinicaNasNuvensClient(cnnStatus.token);

  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  const appointments = await cnnClient.listAppointments(isoDate(from), isoDate(to), EXECUTOR_ID);

  const matches = [];
  for (const appt of appointments) {
    const summary = await cnnClient.getAppointmentSummary(appt.id);
    const normalized = normalizeName(summary.nomePaciente);
    if (targetNames.some((t) => normalized.includes(t) || t.includes(normalized))) {
      const syncedRow = await prisma.syncedAppointment.findUnique({
        where: { cnnAppointmentId: String(appt.id) },
      });

      let googleEvent = null;
      if (syncedRow) {
        try {
          const googleClient = new GoogleCalendarClient();
          const event = await googleClient.getEvent(syncedRow.googleCalendarId, syncedRow.googleEventId);
          googleEvent = { start: event.start, status: event.status };
        } catch (err) {
          googleEvent = { error: err instanceof Error ? err.message : String(err) };
        }
      }

      matches.push({
        cnnAppointmentId: appt.id,
        patientName: summary.nomePaciente,
        status: appt.status,
        data: appt.data,
        horaInicio: appt.horaInicio,
        syncedRow,
        googleEvent,
      });
    }
  }

  return NextResponse.json({ targetNames, totalAppointmentsScanned: appointments.length, matches });
}
