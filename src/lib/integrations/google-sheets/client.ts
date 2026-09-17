import { getValidGoogleAccessToken } from "../google-calendar/connection";
import { getSalesSheetConfig } from "./config";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const PORTUGUESE_MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export class GoogleSheetsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
  }
}

/**
 * A sheet row keyed by its header cell (first row of the resolved range),
 * lowercased and trimmed — e.g. a "Valor Total" column shows up as
 * row["valor total"]. Kept generic like this because the sales sheet has
 * had multiple different column layouts over time (one tab per month, and
 * columns have been added/reordered between months).
 */
export type SalesSheetRow = Record<string, string>;

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

async function authHeader(): Promise<Record<string, string>> {
  const accessToken = await getValidGoogleAccessToken();
  return { Authorization: `Bearer ${accessToken}` };
}

async function listSheetTitles(spreadsheetId: string): Promise<string[]> {
  const response = await fetch(`${API_BASE}/${spreadsheetId}?fields=sheets.properties.title`, {
    headers: await authHeader(),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await safeReadBody(response);
    throw new GoogleSheetsApiError(
      `Failed to list sales spreadsheet tabs: ${describeApiError(response.status, body)}`,
      response.status,
      body
    );
  }

  const data = (await response.json()) as { sheets?: { properties?: { title?: string } }[] };
  return (data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => Boolean(t));
}

export class SalesSheetTabNotFoundError extends Error {}

/**
 * The sales sheet has one tab per month (e.g. "Setembro"), so the target
 * tab has to be re-resolved on every call rather than fixed once in
 * config — otherwise the report would keep reading last month's tab after
 * the month rolls over. SALES_SHEET_RANGE overrides this when set.
 *
 * `referenceDate` picks which month's tab to read — the 8am report email
 * reports on yesterday, so on the 1st of the month it needs last month's
 * tab, not the new (probably still-empty) one `new Date()` would resolve to.
 */
async function resolveSalesRange(referenceDate: Date): Promise<{ spreadsheetId: string; range: string }> {
  const { spreadsheetId, rangeOverride } = getSalesSheetConfig();
  if (rangeOverride) {
    return { spreadsheetId, range: rangeOverride };
  }

  const monthName = PORTUGUESE_MONTHS[referenceDate.getMonth()];
  const titles = await listSheetTitles(spreadsheetId);
  // Tab names don't include a year (just "Setembro", not "Setembro 2026"),
  // and the workbook has now cycled past a full year, so there can be more
  // than one tab with the same month name (e.g. Setembro 2025 AND Setembro
  // 2026) — confirmed live, this was silently reading the 2025 one and
  // reporting 0 sales every day since. Sheets API returns tabs in their
  // left-to-right visual order, which in this workbook is chronological, so
  // the *last* match is the newest one.
  const match = titles.findLast((title) => normalizeForMatch(title) === normalizeForMatch(monthName));

  if (!match) {
    throw new SalesSheetTabNotFoundError(
      `No tab named "${monthName}" found in the sales spreadsheet (tabs: ${titles.join(", ")}). ` +
        "Set SALES_SHEET_RANGE to override auto-detection."
    );
  }

  return { spreadsheetId, range: `${match}!A:Z` };
}

/** Reads the sales sheet tab matching `referenceDate`'s month and returns rows keyed by header. */
export async function getSalesSheetRows(referenceDate: Date = new Date()): Promise<SalesSheetRow[]> {
  const { spreadsheetId, range } = await resolveSalesRange(referenceDate);

  const response = await fetch(`${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers: await authHeader(),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await safeReadBody(response);
    throw new GoogleSheetsApiError(
      `Failed to read the sales sheet: ${describeApiError(response.status, body)}`,
      response.status,
      body
    );
  }

  const data = (await response.json()) as { values?: unknown[][] };
  const [headerRow, ...rows] = data.values ?? [];
  if (!headerRow) return [];

  const headers = headerRow.map((cell) => String(cell).trim().toLowerCase());

  return rows
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => {
      const record: SalesSheetRow = {};
      headers.forEach((header, i) => {
        record[header] = row[i] !== undefined ? String(row[i]) : "";
      });
      return record;
    });
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Surfaces the Google API's own error message when present, so the report page shows something actionable (permission denied, sheet not found, API not enabled, ...) instead of a bare status code. */
function describeApiError(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: string } }).error;
    if (error?.message) return `HTTP ${status} — ${error.message}`;
  }
  return `HTTP ${status}`;
}
