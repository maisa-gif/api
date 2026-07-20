export interface ClinicaNasNuvensEnvConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export class ClinicaNasNuvensConfigError extends Error {}

/**
 * client_id / client_secret are the "internal credentials" issued once per
 * app registration on the Clínica nas Nuvens developer portal. They are
 * read from the environment (never stored in the DB) so they can't leak
 * into a database dump or be edited through the settings UI.
 */
export function getClinicaNasNuvensEnvConfig(): ClinicaNasNuvensEnvConfig {
  const baseUrl =
    process.env.CLINICA_NAS_NUVENS_BASE_URL ?? "https://api.clinicanasnuvens.com.br";
  const clientId = process.env.CLINICA_NAS_NUVENS_CLIENT_ID;
  const clientSecret = process.env.CLINICA_NAS_NUVENS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new ClinicaNasNuvensConfigError(
      "CLINICA_NAS_NUVENS_CLIENT_ID and CLINICA_NAS_NUVENS_CLIENT_SECRET must be set to use the Clínica nas Nuvens integration."
    );
  }

  return { baseUrl, clientId, clientSecret };
}

/** True when the internal credentials are present, without throwing. */
export function hasClinicaNasNuvensEnvConfig(): boolean {
  return Boolean(
    process.env.CLINICA_NAS_NUVENS_CLIENT_ID && process.env.CLINICA_NAS_NUVENS_CLIENT_SECRET
  );
}
