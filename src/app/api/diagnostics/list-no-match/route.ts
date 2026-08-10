import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route — delete once it's clear why the 8 stuck
 * "no_match" SyncedTranscript rows aren't resolving, and whether they're
 * legitimate (no CNN/Bitrix data available) or another matching bug.
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
    where: { status: "no_match" },
    orderBy: { syncedAt: "desc" },
  });

  return NextResponse.json({ count: rows.length, rows });
}
