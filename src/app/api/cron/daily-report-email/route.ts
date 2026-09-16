import { NextResponse } from "next/server";
import { getDailySalesSummary, type DailySalesSummary } from "@/lib/report/daily-sales";
import { getDailyFinanceSummary, type DailyFinanceSummary } from "@/lib/report/daily-finance";
import { yesterdayIso } from "@/lib/report/today";
import { sendGmail } from "@/lib/integrations/gmail/client";

/**
 * Triggered daily at 8am (see vercel.json) — after that hour, salespeople
 * who log sales in the spreadsheet after their shift have already done so,
 * so this reports on yesterday rather than "today" (which would still be
 * empty this early). Protected the same way as the other cron routes: a
 * shared secret Vercel Cron sends automatically as
 * `Authorization: Bearer $CRON_SECRET`.
 */
export const maxDuration = 30;

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateBR(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function salesLine(sales: DailySalesSummary): string {
  if (sales.status === "ok") {
    const count = `${sales.rows.length} venda${sales.rows.length === 1 ? "" : "s"}`;
    return sales.totalValue > 0 ? `${count} — ${formatCurrency(sales.totalValue)}` : count;
  }
  if (sales.status === "not_configured") return "Planilha de vendas não configurada (SALES_SHEET_ID).";
  if (sales.status === "not_connected") return "Google não conectado — conecte em /settings/integrations.";
  return `Erro ao ler a planilha: ${sales.errorMessage}`;
}

function financeLine(finance: DailyFinanceSummary): string {
  if (finance.status === "ok") {
    return `Recebido: ${formatCurrency(finance.totalReceived)} · Pago: ${formatCurrency(finance.totalPaid)}`;
  }
  if (finance.status === "not_connected") return "Conta Azul não conectada — conecte em /settings/integrations.";
  return `Erro ao consultar a Conta Azul: ${finance.errorMessage}`;
}

function buildEmailHtml(date: string, sales: DailySalesSummary, finance: DailyFinanceSummary): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px;">
      <h2>Relatório de ${formatDateBR(date)}</h2>
      <p><strong>Vendas:</strong> ${salesLine(sales)}</p>
      <p><strong>Financeiro (Conta Azul):</strong> ${financeLine(finance)}</p>
    </div>
  `;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = process.env.REPORT_EMAIL_TO;
  if (!to) {
    return NextResponse.json({ error: "REPORT_EMAIL_TO is not configured" }, { status: 500 });
  }

  const date = yesterdayIso();
  const [sales, finance] = await Promise.all([getDailySalesSummary(date), getDailyFinanceSummary(date)]);

  try {
    await sendGmail({ to, subject: `Relatório do dia — ${formatDateBR(date)}`, html: buildEmailHtml(date, sales, finance) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to send email" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, date });
}
