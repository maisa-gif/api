import { NextResponse } from "next/server";
import { getSalesSheetRows } from "@/lib/integrations/google-sheets/client";

/**
 * TEMPORARY diagnostic route — delete once the "0 vendas" discrepancy
 * (sheet has real rows for a date, /relatorio and the daily email report
 * 0) is root-caused. Returns the resolved header keys, total row count,
 * and the first/last 3 rows exactly as our own code parses them, plus any
 * row whose date-ish fields contain "16/09" or "15/09" for direct
 * comparison against the sheet.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await getSalesSheetRows();
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const matching = rows.filter((row) => Object.values(row).some((v) => v.includes("16/09") || v.includes("15/09")));

    return NextResponse.json({
      headers,
      totalRows: rows.length,
      first3: rows.slice(0, 3),
      last3: rows.slice(-3),
      matching,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
