import { prisma } from "@/lib/prisma";
import { refreshAccessToken, type ContaAzulTokens } from "./oauth";

const TYPE = "CONTA_AZUL" as const;
// refresh a bit before actual expiry to avoid racing a request
const EXPIRY_SKEW_MS = 60_000;

export interface ContaAzulConnection {
  connected: boolean;
  enabled: boolean;
  lastSyncAt: Date | null;
}

export async function getContaAzulConnection(): Promise<ContaAzulConnection> {
  const row = await prisma.integration.findUnique({ where: { type: TYPE } });

  return {
    connected: Boolean(row?.refreshToken),
    enabled: row?.enabled ?? false,
    lastSyncAt: row?.lastSyncAt ?? null,
  };
}

export async function saveContaAzulTokens(tokens: ContaAzulTokens): Promise<void> {
  const existing = await prisma.integration.findUnique({ where: { type: TYPE } });

  await prisma.integration.upsert({
    where: { type: TYPE },
    create: {
      type: TYPE,
      enabled: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
    },
    update: {
      enabled: true,
      accessToken: tokens.accessToken,
      // Only Conta Azul's first consent is guaranteed to include a
      // refresh_token; keep the previously stored one otherwise.
      refreshToken: tokens.refreshToken ?? existing?.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
    },
  });
}

export async function disconnectContaAzul(): Promise<void> {
  await prisma.integration.upsert({
    where: { type: TYPE },
    create: { type: TYPE, enabled: false },
    update: {
      enabled: false,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
    },
  });
}

export class ContaAzulNotConnectedError extends Error {}

/** Returns a valid access token, refreshing it first if it's expired/near-expiry. */
export async function getValidContaAzulAccessToken(): Promise<string> {
  const row = await prisma.integration.findUnique({ where: { type: TYPE } });

  if (!row?.refreshToken) {
    throw new ContaAzulNotConnectedError("Conta Azul is not connected.");
  }

  const expiresAt = row.tokenExpiresAt?.getTime() ?? 0;
  if (row.accessToken && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return row.accessToken;
  }

  const refreshed = await refreshAccessToken(row.refreshToken);
  await prisma.integration.update({
    where: { type: TYPE },
    data: {
      accessToken: refreshed.accessToken,
      tokenExpiresAt: refreshed.expiresAt,
      refreshToken: refreshed.refreshToken ?? row.refreshToken,
    },
  });

  return refreshed.accessToken;
}
