export interface ContaAzulEnvConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class ContaAzulConfigError extends Error {}

/**
 * Conta Azul OAuth app credentials, created once in the Conta Azul developer
 * portal (https://developers.contaazul.com — "Credenciais" step), with this
 * app's callback URL registered as the authorized redirect URI.
 * Read from the environment only — never stored in the DB or editable
 * through the UI.
 */
export function getContaAzulEnvConfig(): ContaAzulEnvConfig {
  const clientId = process.env.CONTA_AZUL_CLIENT_ID;
  const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    throw new ContaAzulConfigError(
      "CONTA_AZUL_CLIENT_ID, CONTA_AZUL_CLIENT_SECRET and APP_URL must be set to use the Conta Azul integration."
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, "")}/api/integrations/conta-azul/callback`,
  };
}

export function hasContaAzulEnvConfig(): boolean {
  return Boolean(
    process.env.CONTA_AZUL_CLIENT_ID && process.env.CONTA_AZUL_CLIENT_SECRET && process.env.APP_URL
  );
}
