import { getIntegrationStatus } from "@/lib/integrations/service";
import {
  ClinicaNasNuvensClient,
  ClinicaNasNuvensApiError,
  type ClinicaNasNuvensAppointment,
} from "@/lib/integrations/clinica-nas-nuvens/client";
import { todayIso } from "./today";

export interface DailyAgendaSummary {
  status: "ok" | "not_connected" | "error";
  appointmentCount: number;
  noShowCount: number;
  cancelledCount: number;
  errorMessage?: string;
}

// Confirmed against a live account via a temporary diagnostic route
// (since removed) — the full vocabulary also includes FINALIZADO,
// CONFIRMADO(_PACIENTE), AGENDADO and EM_ESPERA, which aren't needed for
// this count.
const NO_SHOW_STATUSES = ["FALTOU"];
const CANCELLED_STATUSES = ["CANCELADO", "CANCELADO_PACIENTE"];

function countByStatus(appointments: ClinicaNasNuvensAppointment[], statuses: string[]): number {
  return appointments.filter((a) => statuses.includes(a.status)).length;
}

export async function getDailyAgendaSummary(date: string = todayIso()): Promise<DailyAgendaSummary> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", appointmentCount: 0, noShowCount: 0, cancelledCount: 0 };
  }

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const appointments = await client.listAppointments(date, date);
    return {
      status: "ok",
      appointmentCount: appointments.length,
      noShowCount: countByStatus(appointments, NO_SHOW_STATUSES),
      cancelledCount: countByStatus(appointments, CANCELLED_STATUSES),
    };
  } catch (err) {
    const message = err instanceof ClinicaNasNuvensApiError ? err.message : "Erro ao consultar a agenda";
    return { status: "error", appointmentCount: 0, noShowCount: 0, cancelledCount: 0, errorMessage: message };
  }
}
