import {
  getPaidOn,
  getReceivedOn,
  getPayablesDueBetween,
  getReceivablesDueBetween,
  ContaAzulApiError,
} from "@/lib/integrations/conta-azul/client";
import { ContaAzulNotConnectedError } from "@/lib/integrations/conta-azul/connection";
import { todayIso } from "./today";

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
    const message = err instanceof ContaAzulApiError ? err.message : "Erro ao consultar a Conta Azul";
    return { status: "error", totalReceived: 0, totalPaid: 0, errorMessage: message };
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
    const message = err instanceof ContaAzulApiError ? err.message : "Erro ao consultar a Conta Azul";
    return { status: "error", toReceive: 0, toPay: 0, errorMessage: message };
  }
}
