import { NextResponse } from "next/server";
import { disconnectGoogleCalendar } from "@/lib/integrations/google-calendar/connection";

// TODO: gate behind an admin-only auth check before shipping.
export async function POST() {
  await disconnectGoogleCalendar();
  return NextResponse.json({ ok: true });
}
