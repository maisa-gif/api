import { NextResponse } from "next/server";
import { getSalesSheetRows } from "@/lib/integrations/google-sheets/client";
import { yesterdayIso } from "@/lib/report/today";

/**
 * TEMPORARY diagnostic route — delete once the "0 vendas" bug (sheet has
 * real rows for a date, report shows 0) is confirmed fixed. A previous
 * version of this route found the sheet has two same-named month tabs
 * (one per year); this version verifies the index-based tab pick and the
 * resolved rows in one shot.
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
    const yesterday = yesterdayIso();
    const rows = await getSalesSheetRows(new Date(`${yesterday}T12:00:00`));
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const matching = rows.filter((row) => Object.values(row).some((v) => v.includes("16/09") || v.includes("15/09")));

    return NextResponse.json({
      yesterday,
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
