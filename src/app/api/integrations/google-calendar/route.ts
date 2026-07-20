import { NextResponse } from "next/server";
import { getGoogleCalendarConnection } from "@/lib/integrations/google-calendar/connection";
import { hasGoogleCalendarEnvConfig } from "@/lib/integrations/google-calendar/config";

export async function GET() {
  const connection = await getGoogleCalendarConnection();
  return NextResponse.json({ ...connection, hasEnvCredentials: hasGoogleCalendarEnvConfig() });
}
