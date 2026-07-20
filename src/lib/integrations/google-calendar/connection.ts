import { prisma } from "@/lib/prisma";
import { refreshAccessToken, type GoogleTokens } from "./oauth";

const TYPE = "GOOGLE_CALENDAR" as const;
// refresh a bit before actual expiry to avoid racing a request
const EXPIRY_SKEW_MS = 60_000;

export interface GoogleCalendarMetadata {
  email?: string;
}

export interface GoogleCalendarConnection {
  connected: boolean;
  enabled: boolean;
  email: string | null;
  lastSyncAt: Date | null;
}

function parseMetadata(raw: string | null): GoogleCalendarMetadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as GoogleCalendarMetadata;
  } catch {
    return {};
  }
}

export async function getGoogleCalendarConnection(): Promise<GoogleCalendarConnection> {
  const row = await prisma.integration.findUnique({ where: { type: TYPE } });
  const metadata = parseMetadata(row?.metadata ?? null);

  return {
    connected: Boolean(row?.refreshToken),
    enabled: row?.enabled ?? false,
    email: metadata.email ?? null,
    lastSyncAt: row?.lastSyncAt ?? null,
  };
}

export async function saveGoogleCalendarTokens(
  tokens: GoogleTokens,
  metadata: GoogleCalendarMetadata
): Promise<void> {
  const existing = await prisma.integration.findUnique({ where: { type: TYPE } });

  await prisma.integration.upsert({
    where: { type: TYPE },
    create: {
      type: TYPE,
      enabled: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      metadata: JSON.stringify(metadata),
    },
    update: {
      enabled: true,
      accessToken: tokens.accessToken,
      // Google only returns a refresh_token on the first consent; keep the
      // previously stored one on subsequent connects/refreshes.
      refreshToken: tokens.refreshToken ?? existing?.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      metadata: JSON.stringify(metadata),
    },
  });
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await prisma.integration.upsert({
    where: { type: TYPE },
    create: { type: TYPE, enabled: false },
    update: {
      enabled: false,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      metadata: null,
    },
  });
}

export async function markGoogleCalendarSynced(): Promise<void> {
  await prisma.integration.update({ where: { type: TYPE }, data: { lastSyncAt: new Date() } });
}

export class GoogleCalendarNotConnectedError extends Error {}

/** Returns a valid access token, refreshing it first if it's expired/near-expiry. */
export async function getValidGoogleAccessToken(): Promise<string> {
  const row = await prisma.integration.findUnique({ where: { type: TYPE } });

  if (!row?.refreshToken) {
    throw new GoogleCalendarNotConnectedError("Google Calendar is not connected.");
  }

  const expiresAt = row.tokenExpiresAt?.getTime() ?? 0;
  if (row.accessToken && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return row.accessToken;
  }

  const refreshed = await refreshAccessToken(row.refreshToken);
  await prisma.integration.update({
    where: { type: TYPE },
    data: { accessToken: refreshed.accessToken, tokenExpiresAt: refreshed.expiresAt },
  });

  return refreshed.accessToken;
}
