import { getIntegrationStatus } from "@/lib/integrations/service";
import {
  ClinicaNasNuvensClient,
  ClinicaNasNuvensApiError,
  type ClinicaNasNuvensAppointment,
} from "@/lib/integrations/clinica-nas-nuvens/client";
import { todayIso } from "./today";

export interface DailyAgendaProfessionalSummary {
  name: string;
  appointmentCount: number;
  noShowCount: number;
  cancelledCount: number;
}

export interface DailyAgendaSummary {
  status: "ok" | "not_connected" | "error";
  appointmentCount: number;
  noShowCount: number;
  cancelledCount: number;
  byProfessional: DailyAgendaProfessionalSummary[];
  errorMessage?: string;
}

// Confirmed against a live account via temporary diagnostic routes (since
// removed) — the full vocabulary also includes FINALIZADO,
// CONFIRMADO(_PACIENTE), AGENDADO and EM_ESPERA, which aren't needed here.
const NO_SHOW_STATUSES = ["FALTOU"];
const CANCELLED_STATUSES = ["CANCELADO", "CANCELADO_PACIENTE"];

function countByStatus(appointments: ClinicaNasNuvensAppointment[], statuses: string[]): number {
  return appointments.filter((a) => statuses.includes(a.status)).length;
}

function summarize(appointments: ClinicaNasNuvensAppointment[]): Omit<DailyAgendaProfessionalSummary, "name"> {
  return {
    appointmentCount: appointments.length,
    noShowCount: countByStatus(appointments, NO_SHOW_STATUSES),
    cancelledCount: countByStatus(appointments, CANCELLED_STATUSES),
  };
}

export async function getDailyAgendaSummary(date: string = todayIso()): Promise<DailyAgendaSummary> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", appointmentCount: 0, noShowCount: 0, cancelledCount: 0, byProfessional: [] };
  }

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const [appointments, executors] = await Promise.all([client.listAppointments(date, date), client.listExecutors()]);

    const nameById = new Map(executors.map((e) => [e.idpessoa, e.nome]));
    const byExecutor = new Map<number, ClinicaNasNuvensAppointment[]>();
    for (const appointment of appointments) {
      const list = byExecutor.get(appointment.idPessoaExecutor) ?? [];
      list.push(appointment);
      byExecutor.set(appointment.idPessoaExecutor, list);
    }

    const byProfessional = Array.from(byExecutor.entries())
      .map(([executorId, list]) => ({
        name: nameById.get(executorId) ?? `Profissional #${executorId}`,
        ...summarize(list),
      }))
      .sort((a, b) => b.appointmentCount - a.appointmentCount);

    return { status: "ok", ...summarize(appointments), byProfessional };
  } catch (err) {
    const message = err instanceof ClinicaNasNuvensApiError ? err.message : "Erro ao consultar a agenda";
    return { status: "error", appointmentCount: 0, noShowCount: 0, cancelledCount: 0, byProfessional: [], errorMessage: message };
  }
}
