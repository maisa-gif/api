import { NextResponse } from "next/server";
import { GoogleCalendarApiError, GoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY, one-off route — delete once existing future appointments have
 * had a Google Meet link backfilled onto them (new appointments already get
 * one automatically via GoogleCalendarClient.insertEvent). Skips past
 * events and events that already have a link, so it's safe to re-run.
 */
export const maxDuration = 60;

// Each row costs 1-2 Google Calendar API round trips; capping keeps a call
// comfortably inside Vercel's 60s limit. There are more synced appointments
// than fit in one call, so this needs to be triggered a few times in a row
// — safe to re-run since already-linked/past events are skipped.
const MAX_ROWS_PER_CALL = 25;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
  const totalRows = await prisma.syncedAppointment.count();
  const rows = await prisma.syncedAppointment.findMany({
    orderBy: { id: "asc" },
    skip: offset,
    take: MAX_ROWS_PER_CALL,
  });
  const googleClient = new GoogleCalendarClient();

  let added = 0;
  let alreadyHadLink = 0;
  let pastEvent = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const event = await googleClient.getEvent(row.googleCalendarId, row.googleEventId);

      if (event.hangoutLink) {
        alreadyHadLink += 1;
        continue;
      }
      if (new Date(event.start.dateTime) < new Date()) {
        pastEvent += 1;
        continue;
      }

      await googleClient.addMeetLink(row.googleCalendarId, row.googleEventId);
      added += 1;
    } catch (err) {
      if (err instanceof GoogleCalendarApiError && (err.status === 404 || err.status === 410)) {
        notFound += 1;
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Appointment ${row.cnnAppointmentId}: ${message}`);
    }
  }

  const nextOffset = offset + rows.length;
  return NextResponse.json({
    added,
    alreadyHadLink,
    pastEvent,
    notFound,
    errors,
    processedRange: `${offset}-${nextOffset}`,
    totalRows,
    done: nextOffset >= totalRows,
    nextOffset,
  });
}
