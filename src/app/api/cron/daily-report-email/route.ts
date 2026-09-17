import { NextResponse } from "next/server";
import { getDailySalesSummary, type DailySalesSummary } from "@/lib/report/daily-sales";
import { getDailyFinanceSummary, getUpcomingDueSummary, type DailyFinanceSummary, type UpcomingDueSummary } from "@/lib/report/daily-finance";
import { getDailyAgendaSummary, type DailyAgendaSummary } from "@/lib/report/daily-agenda";
import { yesterdayIso, isoPlusDays } from "@/lib/report/today";
import { sendGmail } from "@/lib/integrations/gmail/client";

/**
 * Triggered daily at 8am (see vercel.json) — after that hour, salespeople
 * who log sales in the spreadsheet after their shift have already done so,
 * so sales/financial figures report on yesterday rather than "today"
 * (which would still be empty this early). Protected the same way as the
 * other cron routes: a shared secret Vercel Cron sends automatically as
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * Mirrors the "Bússola da Diretoria" daily routine, but only the sections
 * that have an actual data source wired up (vendas, financeiro, agenda).
 * Enfermagem, RH and the "resumo dos líderes" have no system behind them —
 * those stay as plain reminders in the email, not fabricated numbers.
 */
export const maxDuration = 30;
const UPCOMING_DUE_WINDOW_DAYS = 7;

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateBR(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function salesSection(sales: DailySalesSummary): string {
  if (sales.status === "not_configured") return "<p>Planilha de vendas não configurada (SALES_SHEET_ID).</p>";
  if (sales.status === "not_connected") return "<p>Google não conectado — conecte em /settings/integrations.</p>";
  if (sales.status === "error") return `<p>Erro ao ler a planilha: ${sales.errorMessage}</p>`;

  const count = `${sales.rows.length} venda${sales.rows.length === 1 ? "" : "s"}`;
  const totalsLine = `<p>${sales.totalValue > 0 ? `${count} — ${formatCurrency(sales.totalValue)}` : count}</p>`;

  if (sales.byProduct.length === 0) return totalsLine;

  const rows = sales.byProduct
    .map(
      (p) =>
        `<tr><td style="padding:2px 12px 2px 0;">${p.product}</td><td style="padding:2px 12px;">${p.count} venda${p.count === 1 ? "" : "s"}</td><td style="padding:2px 0;">${formatCurrency(p.totalValue)}</td></tr>`
    )
    .join("");

  return `${totalsLine}<table style="border-collapse:collapse; font-size:14px;">${rows}</table>`;
}

function financeLine(finance: DailyFinanceSummary): string {
  if (finance.status === "ok") {
    return `Recebido: ${formatCurrency(finance.totalReceived)} · Pago: ${formatCurrency(finance.totalPaid)}`;
  }
  if (finance.status === "not_connected") return "Conta Azul não conectada — conecte em /settings/integrations.";
  return `Erro ao consultar a Conta Azul: ${finance.errorMessage}`;
}

function upcomingDueLine(due: UpcomingDueSummary): string {
  if (due.status === "ok") {
    return `A receber: ${formatCurrency(due.toReceive)} · A pagar: ${formatCurrency(due.toPay)}`;
  }
  if (due.status === "not_connected") return "Conta Azul não conectada.";
  return `Erro ao consultar a Conta Azul: ${due.errorMessage}`;
}

function agendaSection(agenda: DailyAgendaSummary): string {
  if (agenda.status === "not_connected") return "<p>Clínica nas Nuvens não conectada.</p>";
  if (agenda.status === "error") return `<p>Erro ao consultar a agenda: ${agenda.errorMessage}</p>`;

  const total = `${agenda.appointmentCount} agendamento${agenda.appointmentCount === 1 ? "" : "s"}`;
  const totalsLine = `<p>${total} — ${agenda.noShowCount} no-show, ${agenda.cancelledCount} cancelamento${agenda.cancelledCount === 1 ? "" : "s"}</p>`;

  if (agenda.byProfessional.length === 0) return totalsLine;

  const rows = agenda.byProfessional
    .map(
      (p) =>
        `<tr><td style="padding:2px 12px 2px 0;">${p.name}</td><td style="padding:2px 12px;">${p.appointmentCount} agend.</td><td style="padding:2px 12px;">${p.noShowCount} no-show</td><td style="padding:2px 0;">${p.cancelledCount} cancel.</td></tr>`
    )
    .join("");

  return `${totalsLine}<table style="border-collapse:collapse; font-size:14px;">${rows}</table>`;
}

function buildEmailHtml(
  yesterday: string,
  sales: DailySalesSummary,
  finance: DailyFinanceSummary,
  due: UpcomingDueSummary,
  agenda: DailyAgendaSummary
): string {
  return `
    <div style="font-family: sans-serif; max-width: 520px;">
      <h2>Relatório de ${formatDateBR(yesterday)}</h2>

      <h3>Vendas (ontem)</h3>
      ${salesSection(sales)}

      <h3>Financeiro (Conta Azul)</h3>
      <p><strong>Ontem:</strong> ${financeLine(finance)}</p>
      <p><strong>A vencer (${formatDateBR(yesterday)} a ${UPCOMING_DUE_WINDOW_DAYS} dias depois):</strong> ${upcomingDueLine(due)}</p>

      <h3>Recepção &amp; agenda (ontem)</h3>
      ${agendaSection(agenda)}

      <h3>Enfermagem</h3>
      <p style="color:#92400e;">Sem integração ainda — pedir para Amanda RT: procedimentos realizados, intercorrências, insumos críticos de sala.</p>

      <h3>RH &amp; equipe</h3>
      <p style="color:#92400e;">Sem integração ainda — pedir para cada líder: faltas do dia, escala coberta.</p>

      <h3>Resumo dos líderes</h3>
      <p style="color:#92400e;">Cobrar de Silas, Paulo e Amanda RT o resumo curto e padronizado do dia.</p>
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

  const yesterday = yesterdayIso();
  const [sales, finance, due, agenda] = await Promise.all([
    getDailySalesSummary(yesterday),
    getDailyFinanceSummary(yesterday),
    getUpcomingDueSummary(yesterday, isoPlusDays(yesterday, UPCOMING_DUE_WINDOW_DAYS)),
    getDailyAgendaSummary(yesterday),
  ]);

  try {
    await sendGmail({
      to,
      subject: `Relatório do dia — ${formatDateBR(yesterday)}`,
      html: buildEmailHtml(yesterday, sales, finance, due, agenda),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to send email" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, date: yesterday });
}
