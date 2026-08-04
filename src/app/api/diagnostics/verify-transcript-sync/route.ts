import { NextResponse } from "next/server";
import { BitrixClient } from "@/lib/integrations/bitrix/client";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route — delete once it's confirmed that synced
 * transcripts are actually landing as Bitrix timeline file attachments
 * and that the linked deal really moved to "Avaliação Realizada".
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
    orderBy: { syncedAt: "desc" },
    take: 15,
  });

  const bitrixClient = new BitrixClient();
  const results = [];

  for (const row of rows) {
    const contactId = row.bitrixContactId!;
    const entry: Record<string, unknown> = {
      file: row.driveFileName,
      contactId,
      dealNote: row.errorMessage,
      syncedAt: row.syncedAt,
    };

    try {
      const comments = await bitrixClient.listContactTimelineComments(contactId);
      const commentsArr = comments as Array<{ COMMENT?: string; FILES?: unknown[] }>;
      const matchingComment = commentsArr.find(
        (c) => typeof c.COMMENT === "string" && c.COMMENT.includes(row.driveFileName)
      );
      entry.fileAttachedInTimeline = Boolean(matchingComment);
      entry.filesOnMatchingComment = matchingComment?.FILES ?? null;
    } catch (err) {
      entry.timelineCheckError = err instanceof Error ? err.message : String(err);
    }

    try {
      const deals = await bitrixClient.findOpenDealsByContact(contactId);
      entry.openDeals = deals.map((d) => ({ id: d.ID, stageId: d.STAGE_ID, categoryId: d.CATEGORY_ID }));
    } catch (err) {
      entry.dealCheckError = err instanceof Error ? err.message : String(err);
    }

    results.push(entry);
  }

  return NextResponse.json({ results });
}
