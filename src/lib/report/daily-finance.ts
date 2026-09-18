import {
  getPaidOn,
  getReceivedOn,
  getPayablesDueBetween,
  getReceivablesDueBetween,
} from "@/lib/integrations/conta-azul/client";
import { ContaAzulNotConnectedError } from "@/lib/integrations/conta-azul/connection";
import { todayIso } from "./today";

/**
 * Surfaces the real error message regardless of where it came from —
 * ContaAzulApiError (a bad API response) or a plain Error (e.g. OAuth
 * token refresh failing in conta-azul/oauth.ts, which doesn't throw
 * ContaAzulApiError). Swallowing that into a generic "Erro ao consultar a
 * Conta Azul" made a real failure (like an expired/revoked refresh token)
 * undiagnosable from the report alone.
 */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "Erro ao consultar a Conta Azul";
}

export interface DailyFinanceSummary {
  status: "ok" | "not_connected" | "error";
  totalReceived: number;
  totalPaid: number;
  errorMessage?: string;
}

export async function getDailyFinanceSummary(date: string = todayIso()): Promise<DailyFinanceSummary> {
  try {
    const [received, paid] = await Promise.all([getReceivedOn(date), getPaidOn(date)]);
    return {
      status: "ok",
      totalReceived: received.reduce((sum, e) => sum + e.pago, 0),
      totalPaid: paid.reduce((sum, e) => sum + e.pago, 0),
    };
  } catch (err) {
    if (err instanceof ContaAzulNotConnectedError) {
      return { status: "not_connected", totalReceived: 0, totalPaid: 0 };
    }
    return { status: "error", totalReceived: 0, totalPaid: 0, errorMessage: describeError(err) };
  }
}

export interface UpcomingDueSummary {
  status: "ok" | "not_connected" | "error";
  toReceive: number;
  toPay: number;
  errorMessage?: string;
}

/** Still-unpaid contas a receber/pagar due between `fromDate` and `toDate` inclusive. */
export async function getUpcomingDueSummary(fromDate: string, toDate: string): Promise<UpcomingDueSummary> {
  try {
    const [receivables, payables] = await Promise.all([
      getReceivablesDueBetween(fromDate, toDate),
      getPayablesDueBetween(fromDate, toDate),
    ]);
    return {
      status: "ok",
      toReceive: receivables.reduce((sum, e) => sum + e.nao_pago, 0),
      toPay: payables.reduce((sum, e) => sum + e.nao_pago, 0),
    };
  } catch (err) {
    if (err instanceof ContaAzulNotConnectedError) {
      return { status: "not_connected", toReceive: 0, toPay: 0 };
    }
    return { status: "error", toReceive: 0, toPay: 0, errorMessage: describeError(err) };
  }
}
