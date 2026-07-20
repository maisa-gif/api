import { NextResponse } from "next/server";
import { exchangeCodeForTokens, verifyOAuthState } from "@/lib/integrations/google-calendar/oauth";
import { saveGoogleCalendarTokens } from "@/lib/integrations/google-calendar/connection";

async function fetchGoogleEmail(accessToken: string): Promise<string | undefined> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return undefined;
  const data = (await response.json()) as { email?: string };
  return data.email;
}

function redirectToSettings(request: Request, status: "connected" | "error"): NextResponse {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("google_calendar", status);
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
    const email = await fetchGoogleEmail(tokens.accessToken);
    await saveGoogleCalendarTokens(tokens, { email });
    return redirectToSettings(request, "connected");
  } catch {
    return redirectToSettings(request, "error");
  }
}
