export interface SalesSheetConfig {
  spreadsheetId: string;
  /** Explicit override, e.g. "Setembro!A:N". When unset, the current tab is
   * auto-detected by matching the current month's Portuguese name against
   * the spreadsheet's tab titles (see resolveSalesRange in ./client) —
   * this sheet has one tab per month (Julho, Agosto, Setembro, ...). */
  rangeOverride: string | null;
}

export class SalesSheetConfigError extends Error {}

/**
 * Which spreadsheet holds the daily sales rows. Read from the environment
 * (not the DB/UI) since it's a single fixed sheet, not a per-account
 * credential.
 */
export function getSalesSheetConfig(): SalesSheetConfig {
  const spreadsheetId = process.env.SALES_SHEET_ID;

  if (!spreadsheetId) {
    throw new SalesSheetConfigError("SALES_SHEET_ID must be set to read the sales sheet.");
  }

  return { spreadsheetId, rangeOverride: process.env.SALES_SHEET_RANGE?.trim() || null };
}

export function hasSalesSheetConfig(): boolean {
  return Boolean(process.env.SALES_SHEET_ID);
}
