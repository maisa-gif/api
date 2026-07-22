import { NextResponse } from "next/server";
import { BitrixClient } from "@/lib/integrations/bitrix/client";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route — delete once it's confirmed where the
 * synced transcript comments actually landed in Bitrix24. Lists the
 * crm.timeline.comment entries for every contact we've already synced a
 * transcript to (from SyncedTranscript rows with status "synced").
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

  const rows = await prisma.syncedTranscript.findMany({
    where: { status: "synced", bitrixContactId: { not: null } },
  });

  const bitrixClient = new BitrixClient();
  const results = [];

  for (const row of rows) {
    try {
      const comments = await bitrixClient.listContactTimelineComments(row.bitrixContactId!);
      results.push({ file: row.driveFileName, contactId: row.bitrixContactId, comments });
    } catch (err) {
      results.push({
        file: row.driveFileName,
        contactId: row.bitrixContactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ results });
}
