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
   * Finds contacts by phone number, comparing digits only. Confirmed
   * against real Bitrix data (via a debug helper trying several
   * strategies) that: (1) the PHONE multifield filter only matches an
   * EXACT stored value, no "%" substring operator support (a "%PHONE"
   * filter silently returned unrelated contacts, not a real substring
   * match); and (2) a combined `{LOGIC: "OR", ...}` filter across two
   * PHONE variants also returned nothing, even though one variant alone
   * matches — crm.contact.list doesn't seem to support that filter shape.
   * So this tries several plain sequential exact-match queries instead,
   * covering two real mismatches seen in production: CNN's phone often
   * omits the "55" country code Bitrix stores it with (CNN
   * "(18) 98176-1667" -> "18981761667" vs Bitrix "5518981761667"), and
   * older-style 8-digit local numbers missing the leading "9" Brazilian
   * mobiles gained after ~2012 (CNN "(18) 9180-2703" vs a Bitrix contact
   * saved with the modern 9-digit "(18) 99180-2703").
   */
  async findContactsByPhone(phone: string): Promise<BitrixContact[]> {
    const digits = normalizePhone(phone);
    if (!digits) return [];
    const last8 = digits.slice(-8);

    const withoutCC = digits.startsWith("55") ? digits.slice(2) : digits;
    const locals = new Set<string>([withoutCC]);
    if (withoutCC.length === 10) {
      // area code (2) + old 8-digit local number -> add the modern
      // 9-digit form (leading "9" inserted after the area code).
      locals.add(`${withoutCC.slice(0, 2)}9${withoutCC.slice(2)}`);
    } else if (withoutCC.length === 11 && withoutCC[2] === "9") {
      // area code (2) + modern 9-digit mobile -> add the old 8-digit form.
      locals.add(`${withoutCC.slice(0, 2)}${withoutCC.slice(3)}`);
    }

    const variants = new Set<string>();
    for (const local of locals) {
      variants.add(local);
      variants.add(`55${local}`);
    }

    const found = new Map<string, BitrixContact>();
    for (const variant of variants) {
      const candidates = await this.call<BitrixContact[]>("crm.contact.list", {
        filter: { PHONE: variant },
        select: ["ID", "NAME", "LAST_NAME", "SECOND_NAME", "PHONE"],
      });
      for (const contact of candidates) {
        if ((contact.PHONE ?? []).some((p) => normalizePhone(p.VALUE).includes(last8))) {
          found.set(contact.ID, contact);
        }
      }
    }

    return [...found.values()];
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

  async getDeal(dealId: string): Promise<BitrixDeal> {
    return this.call<BitrixDeal>("crm.deal.get", { id: dealId });
  }

  async getContact(contactId: string): Promise<BitrixContact> {
    return this.call<BitrixContact>("crm.contact.get", { id: contactId });
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
