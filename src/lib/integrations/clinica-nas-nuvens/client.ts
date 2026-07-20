import { getClinicaNasNuvensEnvConfig } from "./config";

/**
 * NOTE: automated docs lookup at https://api.clinicanasnuvens.com.br was
 * blocked (403) while building this client, so the exact token endpoint
 * path, grant flow, and resource paths below are a best-effort scaffold
 * based on the fields shown in the settings panel (client_id, client_secret,
 * and a per-account `clinicaNasNuvens-cid` token/hash sent on every
 * request). Verify each path/header against the real docs before relying
 * on this in production and adjust the constants here — the rest of the
 * integration (model, settings UI, API routes) does not need to change.
 */

const TOKEN_PATH = "/oauth/token";
const CID_HEADER = "clinicaNasNuvens-cid";

interface AccessToken {
  value: string;
  expiresAt: number;
}

export class ClinicaNasNuvensApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
  }
}

/**
 * Client for the Clínica nas Nuvens public API.
 *
 * `cid` is the per-clinic token/hash shown as "Token/Hash
 * (clinicaNasNuvens-cid)" in the integration settings panel — it identifies
 * which clinic account the calls are made on behalf of, distinct from the
 * app-level client_id/client_secret credentials.
 */
export class ClinicaNasNuvensClient {
  private cachedToken: AccessToken | null = null;

  constructor(private readonly cid: string) {
    if (!cid) {
      throw new Error("ClinicaNasNuvensClient requires a non-empty cid token/hash.");
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }

    const { baseUrl, clientId, clientSecret } = getClinicaNasNuvensEnvConfig();

    const response = await fetch(`${baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      throw new ClinicaNasNuvensApiError(
        "Failed to obtain Clínica nas Nuvens access token",
        response.status,
        await safeReadBody(response)
      );
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };

    this.cachedToken = {
      value: data.access_token,
      // refresh a little early to avoid racing against expiry
      expiresAt: Date.now() + Math.max(data.expires_in - 30, 0) * 1000,
    };

    return this.cachedToken.value;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { baseUrl } = getClinicaNasNuvensEnvConfig();
    const accessToken = await this.getAccessToken();

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
        [CID_HEADER]: this.cid,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new ClinicaNasNuvensApiError(
        `Clínica nas Nuvens request to ${path} failed`,
        response.status,
        await safeReadBody(response)
      );
    }

    return (await response.json()) as T;
  }

  /** Sanity-checks the credentials + cid by making a lightweight call. */
  async testConnection(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
