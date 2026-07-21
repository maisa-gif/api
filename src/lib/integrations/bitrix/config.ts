export class BitrixConfigError extends Error {}

/**
 * Inbound webhook base URL from Bitrix24, e.g.
 * "https://yourcompany.bitrix24.com.br/rest/1/xxxxxxxxxxxxxxxx/" —
 * created in Bitrix24 under Applications > Webhooks > Inbound webhook,
 * with at least "crm" permission. Every REST method is called as
 * `${BITRIX_WEBHOOK_URL}{method}.json`.
 */
export function getBitrixWebhookUrl(): string {
  const url = process.env.BITRIX_WEBHOOK_URL?.trim();
  if (!url) {
    throw new BitrixConfigError("BITRIX_WEBHOOK_URL must be set to use the Bitrix24 integration.");
  }
  return url.endsWith("/") ? url : `${url}/`;
}

export function hasBitrixConfig(): boolean {
  return Boolean(process.env.BITRIX_WEBHOOK_URL?.trim());
}
