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
  errorMessage?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Matches "Cirurgia Transplante Capilar" and spelling variants of it. */
function isHairTransplant(appointment: ClinicaNasNuvensAppointment): boolean {
  return (appointment.procedimentos ?? []).some((p) => {
    const nome = normalize(p.nome ?? "");
    return nome.includes("transplante") && nome.includes("capil");
  });
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
    return { status: "not_connected", rows: [] };
  }

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const surgeries = (await client.listAppointments(`${month}-01`, lastDayOfMonth(month)))
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
    return { status: "ok", rows };
  } catch (err) {
    const errorMessage =
      err instanceof ClinicaNasNuvensApiError
        ? `${err.message} (status ${err.status}, body: ${JSON.stringify(err.body)})`
        : err instanceof Error
          ? err.message
          : String(err);
    return { status: "error", rows: [], errorMessage };
  }
}
