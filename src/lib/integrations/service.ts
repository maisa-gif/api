import { prisma } from "@/lib/prisma";
import { getIntegrationDefinition, listIntegrationDefinitions } from "./registry";
import type { IntegrationType } from "./types";

export interface IntegrationStatus {
  type: IntegrationType;
  name: string;
  description: string;
  docsUrl: string;
  enabled: boolean;
  clientIdLabel: string;
  clientId: string | null;
  clientSecretLabel: string;
  clientSecret: string | null;
  hasEnvCredentials: boolean;
  tokenLabel: string;
  token: string | null;
}

async function getOrCreateRow(type: IntegrationType) {
  return prisma.integration.upsert({
    where: { type },
    update: {},
    create: { type, enabled: false },
  });
}

export async function getIntegrationStatus(type: IntegrationType): Promise<IntegrationStatus> {
  const def = getIntegrationDefinition(type);
  const row = await getOrCreateRow(type);

  return {
    type,
    name: def.name,
    description: def.description,
    docsUrl: def.docsUrl,
    enabled: row.enabled,
    clientIdLabel: def.clientIdLabel,
    clientId: process.env[def.clientIdEnvVar] ?? null,
    clientSecretLabel: def.clientSecretLabel,
    clientSecret: process.env[def.clientSecretEnvVar] ?? null,
    hasEnvCredentials: def.hasEnvCredentials(),
    tokenLabel: def.tokenLabel,
    token: row.token,
  };
}

export async function listIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const defs = listIntegrationDefinitions();
  return Promise.all(defs.map((def) => getIntegrationStatus(def.type)));
}

export async function setIntegrationEnabled(
  type: IntegrationType,
  enabled: boolean
): Promise<IntegrationStatus> {
  await getOrCreateRow(type);
  await prisma.integration.update({ where: { type }, data: { enabled } });
  return getIntegrationStatus(type);
}

export async function setIntegrationToken(
  type: IntegrationType,
  token: string
): Promise<IntegrationStatus> {
  await getOrCreateRow(type);
  await prisma.integration.update({ where: { type }, data: { token } });
  return getIntegrationStatus(type);
}
