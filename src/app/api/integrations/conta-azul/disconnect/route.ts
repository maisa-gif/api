import { NextResponse } from "next/server";
import { disconnectContaAzul } from "@/lib/integrations/conta-azul/connection";

// TODO: gate behind an admin-only auth check before shipping.
export async function POST() {
  await disconnectContaAzul();
  return NextResponse.json({ ok: true });
}
