import { NextResponse } from "next/server";
import { syncDriveTranscriptsToBitrix } from "@/lib/sync/drive-transcripts-bitrix";

/**
 * Triggered on a schedule (see vercel.json) to attach new Google Meet
 * "Gemini notes" files from Drive onto the matching Bitrix24 contact's
 * timeline. Same shared-secret protection as /api/cron/sync-agenda.
 */
// 100+ Drive/Bitrix calls in sequence can take a while.
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

  const result = await syncDriveTranscriptsToBitrix();
  const status = result.errors.length > 0 && result.synced === 0 ? 502 : 200;
  return NextResponse.json(result, { status });
}
