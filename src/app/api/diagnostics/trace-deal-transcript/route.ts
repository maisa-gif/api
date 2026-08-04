import { NextResponse } from "next/server";
import { BitrixClient } from "@/lib/integrations/bitrix/client";
import { GoogleDriveClient } from "@/lib/integrations/google-drive/client";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY diagnostic route — delete once it's clear why a specific
 * deal's transcript hasn't synced yet. Given a Bitrix deal ID, traces the
 * whole chain: deal -> contact -> recent Gemini Drive files -> SyncedTranscript
 * rows, so the exact stuck point (file not there yet, no name/phone match,
 * or an error) can be identified without guessing.
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

  const dealId = new URL(request.url).searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "Missing ?dealId=" }, { status: 400 });
  }

  const bitrixClient = new BitrixClient();
  const result: Record<string, unknown> = {};

  const deal = await bitrixClient.getDeal(dealId);
  result.deal = deal;

  if (!deal.CONTACT_ID) {
    result.error = "Deal has no linked contact.";
    return NextResponse.json(result);
  }

  const contact = await bitrixClient.getContact(deal.CONTACT_ID);
  result.contact = contact;

  const testPhone = new URL(request.url).searchParams.get("testPhone");
  if (testPhone) {
    result.phoneMatchTest = {
      queriedWith: testPhone,
      foundContacts: await bitrixClient.findContactsByPhone(testPhone),
    };
    result.phoneDebug = await bitrixClient.debugPhoneSearch(testPhone);
  }

  const driveClient = new GoogleDriveClient();
  const files = await driveClient.listGeminiNotes();
  result.recentDriveFiles = files.slice(0, 20).map((f) => ({ id: f.id, name: f.name, createdTime: f.createdTime }));

  const syncedRowsForContact = await prisma.syncedTranscript.findMany({
    where: { bitrixContactId: deal.CONTACT_ID },
    orderBy: { syncedAt: "desc" },
  });
  result.syncedTranscriptRowsForThisContact = syncedRowsForContact;

  const recentAllRows = await prisma.syncedTranscript.findMany({
    orderBy: { syncedAt: "desc" },
    take: 10,
  });
  result.mostRecentSyncedTranscriptRowsOverall = recentAllRows;

  return NextResponse.json(result);
}
