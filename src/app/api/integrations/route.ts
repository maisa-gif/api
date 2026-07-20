import { NextResponse } from "next/server";
import { listIntegrationStatuses } from "@/lib/integrations/service";

// TODO: gate behind an admin-only auth check before shipping — this route
// currently returns internal credentials to any caller.
export async function GET() {
  const integrations = await listIntegrationStatuses();
  return NextResponse.json({ integrations });
}
