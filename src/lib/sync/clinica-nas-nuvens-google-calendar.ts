import {
  ClinicaNasNuvensApiError,
  ClinicaNasNuvensClient,
  type ClinicaNasNuvensAppointment,
} from "@/lib/integrations/clinica-nas-nuvens/client";
import { GoogleCalendarClient, type GoogleCalendarEventInput } from "@/lib/integrations/google-calendar/client";
import { getIntegrationStatus } from "@/lib/integrations/service";
import {
  getGoogleCalendarConnection,
  markGoogleCalendarSynced,
} from "@/lib/integrations/google-calendar/connection";
import { prisma } from "@/lib/prisma";

const DEFAULT_CALENDAR_ID = "primary";
const SYNC_WINDOW_DAYS_AHEAD = 30;
const TIME_ZONE = process.env.SYNC_TIME_ZONE ?? "America/Sao_Paulo";

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Includes the HTTP status + response body for ClinicaNasNuvensApiError so
 * sync failures are diagnosable from the /api/cron/sync-agenda response
 * alone, without needing server logs.
 */
function describeError(err: unknown): string {
  if (err instanceof ClinicaNasNuvensApiError) {
    return `${err.message} (status ${err.status}, body: ${JSON.stringify(err.body)})`;
  }
  return err instanceof Error ? err.message : String(err);
}

function toEventInput(appointment: ClinicaNasNuvensAppointment): GoogleCalendarEventInput {
  return {
    summary: appointment.patientName,
    description: appointment.notes,
    location: appointment.location,
    start: { dateTime: appointment.startAt, timeZone: TIME_ZONE },
    end: { dateTime: appointment.endAt, timeZone: TIME_ZONE },
  };
}

/**
 * One-way sync: pulls upcoming appointments from the Clínica nas Nuvens
 * agenda and pushes them into the connected Google Calendar as events,
 * skipping appointments that haven't changed since the last run.
 *
 * Does NOT currently delete Google events for appointments cancelled in
 * CNN or removed from the sync window — only create/update. Add that once
 * the real "cancelled" semantics of the CNN agenda endpoint are confirmed
 * (see the note in clinica-nas-nuvens/client.ts).
 */
export async function syncClinicaNasNuvensAgendaToGoogleCalendar(): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    result.errors.push("Clínica nas Nuvens integration is disabled or missing its token/hash.");
    return result;
  }

  const googleConnection = await getGoogleCalendarConnection();
  if (!googleConnection.connected || !googleConnection.enabled) {
    result.errors.push("Google Calendar is not connected.");
    return result;
  }

  const cnnClient = new ClinicaNasNuvensClient(cnnStatus.token);
  const googleClient = new GoogleCalendarClient();

  const from = new Date();
  const to = new Date(Date.now() + SYNC_WINDOW_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  let appointments: ClinicaNasNuvensAppointment[];
  try {
    appointments = await cnnClient.listAppointments(isoDate(from), isoDate(to));
  } catch (err) {
    result.errors.push(`Failed to fetch CNN agenda: ${describeError(err)}`);
    return result;
  }

  for (const appointment of appointments) {
    try {
      const existing = await prisma.syncedAppointment.findUnique({
        where: { cnnAppointmentId: appointment.id },
      });

      if (existing && existing.sourceUpdatedAt === appointment.updatedAt) {
        result.skipped += 1;
        continue;
      }

      const eventInput = toEventInput(appointment);

      if (existing) {
        await googleClient.updateEvent(existing.googleCalendarId, existing.googleEventId, eventInput);
        await prisma.syncedAppointment.update({
          where: { id: existing.id },
          data: { sourceUpdatedAt: appointment.updatedAt, syncedAt: new Date() },
        });
        result.updated += 1;
      } else {
        const event = await googleClient.insertEvent(DEFAULT_CALENDAR_ID, eventInput);
        await prisma.syncedAppointment.create({
          data: {
            cnnAppointmentId: appointment.id,
            googleEventId: event.id,
            googleCalendarId: DEFAULT_CALENDAR_ID,
            sourceUpdatedAt: appointment.updatedAt,
          },
        });
        result.created += 1;
      }
    } catch (err) {
      result.errors.push(`Appointment ${appointment.id}: ${describeError(err)}`);
    }
  }

  await markGoogleCalendarSynced();
  return result;
}
