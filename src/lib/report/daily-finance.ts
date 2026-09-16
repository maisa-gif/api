import { getPaidOn, getReceivedOn, ContaAzulApiError } from "@/lib/integrations/conta-azul/client";
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
