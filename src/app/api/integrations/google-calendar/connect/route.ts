import { NextResponse } from "next/server";
import { buildGoogleAuthUrl } from "@/lib/integrations/google-calendar/oauth";
import { GoogleCalendarConfigError } from "@/lib/integrations/google-calendar/config";

// TODO: gate behind an admin-only auth check before shipping.
export async function GET() {
  try {
    return NextResponse.redirect(buildGoogleAuthUrl());
  } catch (err) {
    if (err instanceof GoogleCalendarConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }
}
