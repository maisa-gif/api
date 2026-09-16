import { NextResponse } from "next/server";
import { exchangeCodeForTokens, verifyOAuthState } from "@/lib/integrations/conta-azul/oauth";
import { saveContaAzulTokens } from "@/lib/integrations/conta-azul/connection";

function redirectToSettings(request: Request, status: "connected" | "error"): NextResponse {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("conta_azul", status);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state || !verifyOAuthState(state)) {
    return redirectToSettings(request, "error");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveContaAzulTokens(tokens);
    return redirectToSettings(request, "connected");
  } catch {
    return redirectToSettings(request, "error");
  }
}
