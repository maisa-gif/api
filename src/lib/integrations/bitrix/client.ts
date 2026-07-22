import { getBitrixWebhookUrl } from "./config";

export interface BitrixPhone {
  VALUE: string;
  VALUE_TYPE?: string;
}

export interface BitrixContact {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
  SECOND_NAME?: string;
  PHONE?: BitrixPhone[];
}

export interface BitrixDeal {
  ID: string;
  TITLE?: string;
  STAGE_ID: string;
  CATEGORY_ID: string;
  CONTACT_ID?: string;
  CLOSED?: "Y" | "N";
  DATE_CREATE?: string;
}

export interface BitrixDealCategory {
  ID: string;
  NAME: string;
}

export interface BitrixDealStage {
  STATUS_ID: string;
  NAME: string;
  SORT?: string;
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

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Client for Bitrix24's REST API via an inbound webhook (no OAuth —
 * simplest setup for a single-portal integration like this one). See
 * config.ts for how BITRIX_WEBHOOK_URL is obtained.
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
   * Finds contacts matching a full name (e.g. "Victor Cirne Carvalho").
   * Bitrix stores a person's name split across NAME (first)/SECOND_NAME
   * (middle)/LAST_NAME fields, so searching the full string against just
   * NAME never matches — this queries by first name only (Bitrix's
   * "%NAME" substring filter, to keep the candidate set small), then
   * filters client-side to contacts whose combined NAME+SECOND_NAME+
   * LAST_NAME contains both the first and last word of the search name
   * (accent/case-insensitive). Middle-name mismatches are tolerated since
   * CNN and Bitrix may not record them the same way.
   */
  async findContactsByName(fullName: string): Promise<BitrixContact[]> {
    const targetWords = normalizeName(fullName).split(" ").filter(Boolean);
    if (targetWords.length === 0) return [];

    const candidates = await this.call<BitrixContact[]>("crm.contact.list", {
      filter: { "%NAME": targetWords[0] },
      select: ["ID", "NAME", "LAST_NAME", "SECOND_NAME"],
    });

    const firstWord = targetWords[0];
    const lastWord = targetWords[targetWords.length - 1];

    return candidates.filter((contact) => {
      const combined = normalizeName(
        [contact.NAME, contact.SECOND_NAME, contact.LAST_NAME].filter(Boolean).join(" ")
      );
      return combined.includes(firstWord) && combined.includes(lastWord);
    });
  }

  /**
   * Finds contacts by phone number, comparing digits only (formatting
   * like "(18) 99715-8051" vs "5518997158051" varies between what CNN
   * records and what's stored in Bitrix). Unverified against real
   * Bitrix24 phone data — Bitrix's PHONE multifield filter behavior may
   * need adjusting once tested.
   */
  async findContactsByPhone(phone: string): Promise<BitrixContact[]> {
    const digits = normalizePhone(phone);
    if (!digits) return [];

    const candidates = await this.call<BitrixContact[]>("crm.contact.list", {
      filter: { PHONE: digits },
      select: ["ID", "NAME", "LAST_NAME", "SECOND_NAME", "PHONE"],
    });

    // Belt-and-suspenders client-side check in case Bitrix's filter is
    // looser than an exact/contains digit match.
    return candidates.filter((contact) =>
      (contact.PHONE ?? []).some((p) => normalizePhone(p.VALUE).includes(digits.slice(-8)))
    );
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

  /** Lists timeline comments on a contact — used to verify a post actually landed. */
  async listContactTimelineComments(contactId: string): Promise<unknown[]> {
    return this.call<unknown[]>("crm.timeline.comment.list", {
      filter: { ENTITY_ID: contactId, ENTITY_TYPE: "contact" },
    });
  }

  /**
   * Finds open deals linked to a contact, most recently created first.
   * Deals don't carry their own phone field in Bitrix (phone lives on the
   * contact/lead/company), so "matching a deal by phone" goes through the
   * contact already matched by phone via findContactsByPhone().
   */
  async findOpenDealsByContact(contactId: string): Promise<BitrixDeal[]> {
    const deals = await this.call<BitrixDeal[]>("crm.deal.list", {
      filter: { CONTACT_ID: contactId, CLOSED: "N" },
      select: ["ID", "TITLE", "STAGE_ID", "CATEGORY_ID", "CONTACT_ID", "CLOSED", "DATE_CREATE"],
      order: { DATE_CREATE: "DESC" },
    });
    return deals;
  }

  /** Moves a deal to a different pipeline stage. */
  async updateDealStage(dealId: string, stageId: string): Promise<void> {
    await this.call("crm.deal.update", {
      id: dealId,
      fields: { STAGE_ID: stageId },
    });
  }

  /** Lists deal pipelines ("funis") — used to discover STAGE_IDs for updateDealStage(). */
  async listDealCategories(): Promise<BitrixDealCategory[]> {
    return this.call<BitrixDealCategory[]>("crm.dealcategory.list", {});
  }

  /** Lists the stages of a given pipeline (category ID "0" is the default pipeline). */
  async listDealStages(categoryId: string): Promise<BitrixDealStage[]> {
    return this.call<BitrixDealStage[]>("crm.dealcategory.stage.list", { id: categoryId });
  }
}
