import { createHmac, timingSafeEqual } from "node:crypto";
import { getGoogleCalendarEnvConfig } from "./config";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  // Read-only access to the whole Drive is required (not the narrower
  // drive.file scope) because the Gemini meeting-notes files are created
  // by Google Meet, not by this app, so they're outside drive.file's
  // "files the app created or the user picked" boundary.
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
];
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

/**
 * Signs a short-lived `state` param (HMAC over a timestamp, keyed with the
 * OAuth client secret) instead of persisting server-side session state —
 * this app has no session/user system, so the callback verifies the
 * signature + expiry rather than looking up a stored nonce.
 */
export function createOAuthState(): string {
  const { clientSecret } = getGoogleCalendarEnvConfig();
  const payload = Buffer.from(JSON.stringify({ ts: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", clientSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string): boolean {
  const { clientSecret } = getGoogleCalendarEnvConfig();
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = createHmac("sha256", clientSecret).update(payload).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const { ts } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { ts: number };
    return Date.now() - ts <= STATE_TTL_MS;
  } catch {
    return false;
  }
}

export function buildGoogleAuthUrl(): string {
  const { clientId, redirectUri } = getGoogleCalendarEnvConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // forces Google to re-issue a refresh_token even on a repeat connect
    prompt: "consent",
    state: createOAuthState(),
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret, redirectUri } = getGoogleCalendarEnvConfig();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange Google OAuth code: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = getGoogleCalendarEnvConfig();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Google access token: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number; scope: string };

  return {
    accessToken: data.access_token,
    // Google does not re-issue a refresh_token on refresh — the caller
    // keeps using the one it already stored.
    refreshToken: null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  };
}
