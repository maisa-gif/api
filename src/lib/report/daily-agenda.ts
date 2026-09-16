import { getIntegrationStatus } from "@/lib/integrations/service";
import { ClinicaNasNuvensClient, ClinicaNasNuvensApiError } from "@/lib/integrations/clinica-nas-nuvens/client";
import { todayIso } from "./today";

export interface DailyAgendaSummary {
  status: "ok" | "not_connected" | "error";
  appointmentCount: number;
  errorMessage?: string;
}

/**
 * Just a headcount of today's appointments — the Bússola da Diretoria's
 * "ocupação %" and "no-shows" breakdown would need the real Clínica nas
 * Nuvens `status` vocabulary (e.g. which string means "no-show" vs
 * "cancelado" vs "confirmado") confirmed against a live account first,
 * same way the Conta Azul fields were confirmed earlier — nothing in this
 * codebase pins those down yet, so don't guess at them here.
 */
export async function getDailyAgendaSummary(date: string = todayIso()): Promise<DailyAgendaSummary> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", appointmentCount: 0 };
  }

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const appointments = await client.listAppointments(date, date);
    return { status: "ok", appointmentCount: appointments.length };
  } catch (err) {
    const message = err instanceof ClinicaNasNuvensApiError ? err.message : "Erro ao consultar a agenda";
    return { status: "error", appointmentCount: 0, errorMessage: message };
  }
}
