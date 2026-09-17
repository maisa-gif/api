import {
  getSalesSheetRows,
  GoogleSheetsApiError,
  SalesSheetTabNotFoundError,
  type SalesSheetRow,
} from "@/lib/integrations/google-sheets/client";
import { SalesSheetConfigError } from "@/lib/integrations/google-sheets/config";
import { GoogleCalendarNotConnectedError } from "@/lib/integrations/google-calendar/connection";
import { todayIso } from "./today";

export interface DailySalesByProduct {
  product: string;
  count: number;
  totalValue: number;
}

export interface DailySalesSummary {
  status: "ok" | "not_configured" | "not_connected" | "error";
  rows: SalesSheetRow[];
  totalValue: number;
  byProduct: DailySalesByProduct[];
  errorMessage?: string;
}

// Checked in order — "data da compra" is the sale date on the current tab
// layout; "data" alone covers older tabs that only ever had one date
// column. Order matters: don't match "data da cirurgia"/"data do
// procedimento" (those are the surgery date, not the sale date).
const DATE_HEADER_CANDIDATES = ["data da compra", "data"];
const VALUE_HEADER_CANDIDATES = ["valor total", "preço", "preco", "valor"];
const STATUS_HEADER_CANDIDATES = ["status"];
const PRODUCT_HEADER_CANDIDATES = ["produto"];
const WON_STATUSES = ["ganho", "aceito"];

function findHeader(headers: string[], candidates: string[]): string | undefined {
  return candidates.find((c) => headers.includes(c));
}

/** Accepts either "YYYY-MM-DD" or "DD/MM/YYYY" and normalizes to "YYYY-MM-DD". */
function normalizeDate(raw: string): string | null {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  return null;
}

/** Parses a Brazilian-formatted currency string, e.g. "R$ 16.974,00" -> 16974. */
function parseBRLCurrency(raw: string): number {
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  return Number(normalized) || 0;
}

/**
 * Rows for `date` (YYYY-MM-DD, defaults to today), filtered by whatever
 * column looks like the sale date. Column names aren't hard-coded to one
 * fixed schema — the underlying sheet has a tab per month and the columns
 * have changed across tabs over time, so this reads the header row of the
 * resolved range and matches known Portuguese header names instead. Adjust
 * the *_HEADER_CANDIDATES above if a future tab renames these columns again.
 */
function groupByProduct(rows: SalesSheetRow[], productHeader: string | undefined, valueHeader: string | undefined): DailySalesByProduct[] {
  if (!productHeader) return [];

  const byProduct = new Map<string, DailySalesByProduct>();
  for (const row of rows) {
    const product = row[productHeader].trim() || "Sem produto";
    const value = valueHeader ? parseBRLCurrency(row[valueHeader]) : 0;
    const existing = byProduct.get(product);
    if (existing) {
      existing.count += 1;
      existing.totalValue += value;
    } else {
      byProduct.set(product, { product, count: 1, totalValue: value });
    }
  }

  return Array.from(byProduct.values()).sort((a, b) => b.totalValue - a.totalValue);
}

export async function getDailySalesSummary(date: string = todayIso()): Promise<DailySalesSummary> {
  try {
    // Noon avoids any midnight/timezone rounding landing on the wrong
    // month when resolving which sheet tab to read.
    const allRows = await getSalesSheetRows(new Date(`${date}T12:00:00`));
    if (allRows.length === 0) {
      return { status: "ok", rows: [], totalValue: 0, byProduct: [] };
    }

    const headers = Object.keys(allRows[0]);
    const dateHeader = findHeader(headers, DATE_HEADER_CANDIDATES);
    const valueHeader = findHeader(headers, VALUE_HEADER_CANDIDATES);
    const statusHeader = findHeader(headers, STATUS_HEADER_CANDIDATES);
    const productHeader = findHeader(headers, PRODUCT_HEADER_CANDIDATES);

    let rows = dateHeader ? allRows.filter((row) => normalizeDate(row[dateHeader]) === date) : allRows;
    if (statusHeader) {
      rows = rows.filter((row) => WON_STATUSES.includes(row[statusHeader].trim().toLowerCase()));
    }

    const totalValue = valueHeader ? rows.reduce((sum, row) => sum + parseBRLCurrency(row[valueHeader]), 0) : 0;
    const byProduct = groupByProduct(rows, productHeader, valueHeader);

    return { status: "ok", rows, totalValue, byProduct };
  } catch (err) {
    if (err instanceof SalesSheetConfigError) {
      return { status: "not_configured", rows: [], totalValue: 0, byProduct: [] };
    }
    if (err instanceof GoogleCalendarNotConnectedError) {
      return { status: "not_connected", rows: [], totalValue: 0, byProduct: [] };
    }
    const message =
      err instanceof GoogleSheetsApiError || err instanceof SalesSheetTabNotFoundError
        ? err.message
        : "Erro ao ler a planilha de vendas";
    return { status: "error", rows: [], totalValue: 0, byProduct: [], errorMessage: message };
  }
}
