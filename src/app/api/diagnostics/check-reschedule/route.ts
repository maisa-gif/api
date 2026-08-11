import { NextResponse } from "next/server";
import { ClinicaNasNuvensClient } from "@/lib/integrations/clinica-nas-nuvens/client";
import { GoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { getIntegrationStatus } from "@/lib/integrations/service";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route — delete once it's clear why some
 * rescheduled patients still show on today's Google Calendar. Lists
 * today's Google Calendar events, matches by name, then looks up each
 * match's CNN appointment directly by ID (via the reverse SyncedAppointment
 * mapping) to compare current CNN status/date against the Google event.
 */
export const maxDuration = 60;

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
  const googleClient = new GoogleCalendarClient();

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const todaysEvents = await googleClient.listEvents(
    "primary",
    startOfDay.toISOString(),
    endOfDay.toISOString()
  );

  const matches = [];
  for (const event of todaysEvents) {
    const normalized = normalizeName(event.summary ?? "");
    if (!targetNames.some((t) => normalized.includes(t) || t.includes(normalized))) continue;

    const syncedRow = await prisma.syncedAppointment.findFirst({
      where: { googleEventId: event.id },
    });

    let cnnAppointment = null;
    if (syncedRow) {
      try {
        cnnAppointment = await cnnClient.getAppointmentSummary(Number(syncedRow.cnnAppointmentId));
      } catch (err) {
        cnnAppointment = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    matches.push({
      googleEventId: event.id,
      googleSummary: event.summary,
      googleStart: event.start,
      googleStatus: event.status,
      syncedRow,
      cnnAppointment,
    });
  }

  return NextResponse.json({
    targetNames,
    totalTodaysEvents: todaysEvents.length,
    todaysEventSummaries: todaysEvents.map((e) => e.summary),
    matches,
  });
}
