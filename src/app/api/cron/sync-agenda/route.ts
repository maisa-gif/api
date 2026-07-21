import { NextResponse } from "next/server";
import { syncClinicaNasNuvensAgendaToGoogleCalendar } from "@/lib/sync/clinica-nas-nuvens-google-calendar";

/**
 * Triggered on a schedule (see vercel.json) to push CNN agenda appointments
 * into the connected Google Calendar. Protected with a shared secret since
 * this app has no user auth system — Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is
 * set as an env var; any other scheduler must send the same header.
 */
// Fetching each appointment's summary (for the patient name) plus a
// Google Calendar call per appointment adds up past the Hobby-plan 10s
// default as the agenda grows.
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncClinicaNasNuvensAgendaToGoogleCalendar();
  const status = result.errors.length > 0 && result.created === 0 && result.updated === 0 ? 502 : 200;
  return NextResponse.json(result, { status });
}
