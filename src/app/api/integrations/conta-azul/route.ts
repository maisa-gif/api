import { NextResponse } from "next/server";
import { getContaAzulConnection } from "@/lib/integrations/conta-azul/connection";
import { hasContaAzulEnvConfig } from "@/lib/integrations/conta-azul/config";

export async function GET() {
  const connection = await getContaAzulConnection();
  return NextResponse.json({ ...connection, hasEnvCredentials: hasContaAzulEnvConfig() });
}
