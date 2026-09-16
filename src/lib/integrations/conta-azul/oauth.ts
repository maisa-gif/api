import { createHmac, timingSafeEqual } from "node:crypto";
import { getContaAzulEnvConfig } from "./config";

/**
 * Conta Azul's OAuth server (auth.contaazul.com) follows the same
 * /oauth2/authorize + /oauth2/token shape as an AWS Cognito hosted UI.
 * Confirmed against https://developers.contaazul.com/auth and
 * https://developers.contaazul.com/requestingcode via search (the docs
 * site itself is blocked by this environment's network egress proxy, so
 * these were not verified against the live Swagger/OpenAPI spec). Recheck
 * the "Credenciais" step in the developer portal once an app is
 * registered — in particular the exact `scope` value, which is
 * app-specific and not confirmed here.
 */
const AUTH_ENDPOINT = "https://auth.contaazul.com/oauth2/authorize";
const TOKEN_ENDPOINT = "https://auth.contaazul.com/oauth2/token";
// TODO: confirm the exact scope string(s) required for financial (contas a
// pagar/receber) read access in the developer portal — "openid" alone may
// not be enough to call the financial APIs.
const SCOPES = ["openid"];
const STATE_TTL_MS = 10 * 60 * 1000;

export interface ContaAzulTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

/**
 * Signs a short-lived `state` param (HMAC over a timestamp, keyed with the
 * OAuth client secret) instead of persisting server-side session state —
 * this app has no session/user system, so the callback verifies the
 * signature + expiry rather than looking up a stored nonce.
 */
export function createOAuthState(): string {
  const { clientSecret } = getContaAzulEnvConfig();
  const payload = Buffer.from(JSON.stringify({ ts: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", clientSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string): boolean {
  const { clientSecret } = getContaAzulEnvConfig();
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

export function buildContaAzulAuthUrl(): string {
  const { clientId, redirectUri } = getContaAzulEnvConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state: createOAuthState(),
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = getContaAzulEnvConfig();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

interface ContaAzulTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(code: string): Promise<ContaAzulTokens> {
  const { redirectUri } = getContaAzulEnvConfig();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange Conta Azul OAuth code: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as ContaAzulTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<ContaAzulTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Conta Azul access token: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as ContaAzulTokenResponse;

  return {
    accessToken: data.access_token,
    // Cognito-style token endpoints generally don't re-issue a refresh_token
    // on refresh — keep using the one already stored.
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}
