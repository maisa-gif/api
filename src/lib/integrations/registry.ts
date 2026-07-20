import { hasClinicaNasNuvensEnvConfig } from "./clinica-nas-nuvens/config";
import type { IntegrationType } from "./types";

export interface IntegrationDefinition {
  type: IntegrationType;
  name: string;
  description: string;
  docsUrl: string;
  /** Label for the internal client_id field, read from env. */
  clientIdLabel: string;
  clientIdEnvVar: string;
  /** Label for the internal client_secret field, read from env. */
  clientSecretLabel: string;
  clientSecretEnvVar: string;
  /** Label for the per-account token/hash stored in the DB and editable in the UI. */
  tokenLabel: string;
  /** Whether the env-provided client_id/client_secret are configured on this deployment. */
  hasEnvCredentials: () => boolean;
}

export const INTEGRATION_REGISTRY: Record<IntegrationType, IntegrationDefinition> = {
  CLINICA_NAS_NUVENS: {
    type: "CLINICA_NAS_NUVENS",
    name: "Clínica nas Nuvens",
    description:
      "Aqui você encontra os dados necessários para integração com a API pública do Clínica nas Nuvens. Para saber como utilizar as chaves de autenticação, consulte",
    docsUrl: "https://api.clinicanasnuvens.com.br",
    clientIdLabel: "Credenciais internas (client_id)",
    clientIdEnvVar: "CLINICA_NAS_NUVENS_CLIENT_ID",
    clientSecretLabel: "Credenciais internas (client_secret)",
    clientSecretEnvVar: "CLINICA_NAS_NUVENS_CLIENT_SECRET",
    tokenLabel: "Token/Hash (clinicaNasNuvens-cid)",
    hasEnvCredentials: hasClinicaNasNuvensEnvConfig,
  },
};

export function getIntegrationDefinition(type: IntegrationType): IntegrationDefinition {
  return INTEGRATION_REGISTRY[type];
}

export function listIntegrationDefinitions(): IntegrationDefinition[] {
  return Object.values(INTEGRATION_REGISTRY);
}
