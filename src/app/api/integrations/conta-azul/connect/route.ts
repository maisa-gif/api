import { NextResponse } from "next/server";
import { buildContaAzulAuthUrl } from "@/lib/integrations/conta-azul/oauth";
import { ContaAzulConfigError } from "@/lib/integrations/conta-azul/config";

// TODO: gate behind an admin-only auth check before shipping.
export async function GET() {
  try {
    return NextResponse.redirect(buildContaAzulAuthUrl());
  } catch (err) {
    if (err instanceof ContaAzulConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }
}
