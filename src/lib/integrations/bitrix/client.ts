import { getBitrixWebhookUrl } from "./config";

export interface BitrixContact {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
  SECOND_NAME?: string;
}

export class BitrixApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
  }
}

/**
 * Client for Bitrix24's REST API via an inbound webhook (no OAuth —
 * simplest setup for a single-portal integration like this one). See
 * config.ts for how BITRIX_WEBHOOK_URL is obtained.
 *
 * NOTE: contact name matching (findContactByName) is unverified against
 * real Bitrix24 data — Bitrix splits a person's name across NAME/
 * LAST_NAME/SECOND_NAME fields, and how CNN patient names map onto that
 * split isn't confirmed yet. Adjust the filter strategy once tested
 * against a real portal.
 */
export class BitrixClient {
  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const webhookUrl = getBitrixWebhookUrl();

    const response = await fetch(`${webhookUrl}${method}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = (await response.json().catch(() => null)) as
      | { result: T }
      | { error: string; error_description?: string }
      | null;

    if (!response.ok || !data || "error" in data) {
      const message =
        data && "error_description" in data && data.error_description
          ? data.error_description
          : `Bitrix24 ${method} failed`;
      throw new BitrixApiError(message, response.status, data);
    }

    return data.result;
  }

  /**
   * Finds contacts whose first name contains `name` (case-insensitive
   * substring match via Bitrix's "%FIELD" filter operator). Returns
   * every match — callers should decide how to handle 0 or >1 results.
   */
  async findContactsByName(name: string): Promise<BitrixContact[]> {
    return this.call<BitrixContact[]>("crm.contact.list", {
      filter: { "%NAME": name },
      select: ["ID", "NAME", "LAST_NAME", "SECOND_NAME"],
    });
  }

  /**
   * Posts a CRM timeline comment with a file attachment on the given
   * contact — this is what shows up as an activity on the contact's card
   * in the Bitrix24 UI.
   */
  async attachFileToContactTimeline(
    contactId: string,
    comment: string,
    file: { name: string; bytes: Buffer }
  ): Promise<void> {
    await this.call("crm.timeline.comment.add", {
      fields: {
        ENTITY_ID: contactId,
        ENTITY_TYPE: "contact",
        COMMENT: comment,
        FILES: [[file.name, file.bytes.toString("base64")]],
      },
    });
  }
}
