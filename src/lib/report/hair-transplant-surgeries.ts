import { getIntegrationStatus } from "@/lib/integrations/service";
import {
  ClinicaNasNuvensClient,
  ClinicaNasNuvensApiError,
  type ClinicaNasNuvensAppointment,
} from "@/lib/integrations/clinica-nas-nuvens/client";

// CNN rejects more than 120 requests/minute (429), so calls are spaced to
// stay at ~100/minute.
const REQUEST_INTERVAL_MS = 600;
const RATE_LIMIT_RETRY_MS = 60_000;
const CANCELLED_STATUSES = ["CANCELADO", "CANCELADO_PACIENTE"];

export interface HairTransplantSurgery {
  codigo: number;
  data: string;
  horaInicio: string;
  paciente: string | null;
}

export interface HairTransplantSurgeriesResult {
  status: "ok" | "not_connected" | "error";
  rows: HairTransplantSurgery[];
  /** Every appointment in the month, cancelled ones included. */
  appointmentCount: number;
  /** Procedure name → appointments using it, to spot how surgeries are named when nothing matches. */
  procedureCounts: [string, number][];
  errorMessage?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Matches "Cirurgia Transplante Capilar" and variants of it, whether the
 * clinic recorded it as a procedure or only in the appointment's notes.
 */
function isHairTransplant(appointment: ClinicaNasNuvensAppointment): boolean {
  const texts = [...(appointment.procedimentos ?? []).map((p) => p.nome ?? ""), appointment.observacoes ?? ""];
  return texts.some((text) => {
    const t = normalize(text);
    return t.includes("transplante") || t.includes("capilar");
  });
}

function countProcedures(appointments: ClinicaNasNuvensAppointment[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const appointment of appointments) {
    const names = (appointment.procedimentos ?? []).map((p) => p.nome).filter(Boolean);
    for (const name of names.length > 0 ? names : ["(sem procedimento)"]) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** Last day of `month` (YYYY-MM) as YYYY-MM-DD. */
function lastDayOfMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Lists the month's (YYYY-MM) non-cancelled CNN appointments that include a
 * hair transplant procedure. /agenda/lista has no patient name, so each
 * match's name comes from /agenda/{id}/resumida.
 */
export async function getHairTransplantSurgeries(month: string): Promise<HairTransplantSurgeriesResult> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", rows: [], appointmentCount: 0, procedureCounts: [] };
  }

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const appointments = await client.listAppointments(`${month}-01`, lastDayOfMonth(month));
    const surgeries = appointments
      .filter((a) => !CANCELLED_STATUSES.includes(a.status) && isHairTransplant(a))
      .sort((a, b) => `${a.data} ${a.horaInicio}`.localeCompare(`${b.data} ${b.horaInicio}`));

    const rows = await Promise.all(
      surgeries.map(async (appointment, i) => {
        await sleep((i + 1) * REQUEST_INTERVAL_MS);
        const fetchName = () => client.getAppointmentSummary(appointment.id).then((s) => s.nomePaciente);
        let paciente: string | null;
        try {
          paciente = await fetchName();
        } catch (err) {
          if (!(err instanceof ClinicaNasNuvensApiError && err.status === 429)) throw err;
          await sleep(RATE_LIMIT_RETRY_MS);
          paciente = await fetchName();
        }
        return { codigo: appointment.id, data: appointment.data, horaInicio: appointment.horaInicio, paciente };
      })
    );
    return { status: "ok", rows, appointmentCount: appointments.length, procedureCounts: countProcedures(appointments) };
  } catch (err) {
    const errorMessage =
      err instanceof ClinicaNasNuvensApiError
        ? `${err.message} (status ${err.status}, body: ${JSON.stringify(err.body)})`
        : err instanceof Error
          ? err.message
          : String(err);
    return { status: "error", rows: [], appointmentCount: 0, procedureCounts: [], errorMessage };
  }
}
