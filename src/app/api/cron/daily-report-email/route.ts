import { NextResponse } from "next/server";
import { getDailySalesSummary, type DailySalesSummary } from "@/lib/report/daily-sales";
import { getDailyFinanceSummary, getUpcomingDueSummary, type DailyFinanceSummary, type UpcomingDueSummary } from "@/lib/report/daily-finance";
import { getDailyAgendaSummary, type DailyAgendaSummary } from "@/lib/report/daily-agenda";
import { yesterdayIso, todayIso, todayPlusDaysIso } from "@/lib/report/today";
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

function upcomingDueLine(due: UpcomingDueSummary): string {
  if (due.status === "ok") {
    return `A receber: ${formatCurrency(due.toReceive)} · A pagar: ${formatCurrency(due.toPay)}`;
  }
  if (due.status === "not_connected") return "Conta Azul não conectada.";
  return `Erro ao consultar a Conta Azul: ${due.errorMessage}`;
}

function agendaLine(agenda: DailyAgendaSummary): string {
  if (agenda.status === "ok") {
    return `${agenda.appointmentCount} agendamento${agenda.appointmentCount === 1 ? "" : "s"} hoje`;
  }
  if (agenda.status === "not_connected") return "Clínica nas Nuvens não conectada.";
  return `Erro ao consultar a agenda: ${agenda.errorMessage}`;
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
      <p>${salesLine(sales)}</p>

      <h3>Financeiro (Conta Azul)</h3>
      <p><strong>Ontem:</strong> ${financeLine(finance)}</p>
      <p><strong>A vencer nos próximos ${UPCOMING_DUE_WINDOW_DAYS} dias:</strong> ${upcomingDueLine(due)}</p>

      <h3>Recepção &amp; agenda (hoje)</h3>
      <p>${agendaLine(agenda)}</p>

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
    getUpcomingDueSummary(todayIso(), todayPlusDaysIso(UPCOMING_DUE_WINDOW_DAYS)),
    getDailyAgendaSummary(),
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
