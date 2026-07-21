import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route — delete once transcript matching is
 * confirmed working. Dumps the current SyncedTranscript rows so match
 * failures/skips can be inspected without direct DB access.
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
    orderBy: { syncedAt: "desc" },
    select: {
      driveFileName: true,
      matchedName: true,
      status: true,
      bitrixContactId: true,
      errorMessage: true,
      syncedAt: true,
    },
  });

  return NextResponse.json({ rows });
}
