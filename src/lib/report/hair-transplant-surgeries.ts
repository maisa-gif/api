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
  procedimentos: string;
  tipoAtendimento: string | null;
  observacoes: string | null;
  status: string;
}

export interface HairTransplantSurgeriesResult {
  status: "ok" | "not_connected" | "error";
  rows: HairTransplantSurgery[];
  /** Every appointment in the month, cancelled ones included. */
  appointmentCount: number;
  /** The month's procedure types (idTipoProcedimento), to pick the one surgeries are filed under. */
  procedureTypes: ProcedureType[];
  /** False when CNN sent no "tipo de atendimento" text, so the match fell back to procedures/notes. */
  matchedByTipoAtendimento: boolean;
  errorMessage?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The appointment's "tipo de atendimento" (e.g. "Cirurgia Transplante
 * Capilar"), which the clinic uses to mark surgeries. Not in the typed
 * client shape since its exact field name in /agenda/lista is unconfirmed,
 * so any top-level key like tipoAtendimento is read, as text or as an
 * object with a name.
 */
function tipoAtendimento(appointment: ClinicaNasNuvensAppointment): string | null {
  for (const [key, value] of Object.entries(appointment as unknown as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (!k.includes("tipo") || !k.includes("atendimento")) continue;
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object") {
      const named = value as Record<string, unknown>;
      const text = named.nome ?? named.descricao ?? named.tipo;
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return null;
}

/**
 * Matches tipo de atendimento "Cirurgia Transplante Capilar". CNN's agenda
 * list sends that only as each procedure's numeric idTipoProcedimento, so
 * `tipos` (picked on the page from the month's procedure types) takes
 * precedence. Without it, falls back to procedure names — notes are left
 * out since consultations mention the transplant there too.
 */
function isHairTransplant(appointment: ClinicaNasNuvensAppointment, tipos: number[]): boolean {
  if (tipos.length > 0) {
    return (appointment.procedimentos ?? []).some((p) => tipos.includes(p.idTipoProcedimento));
  }
  const tipo = tipoAtendimento(appointment);
  if (tipo !== null) {
    const t = normalize(tipo);
    return t.includes("transplante") && t.includes("capil");
  }
  return (appointment.procedimentos ?? []).some((p) => {
    const t = normalize(p.nome ?? "");
    // "capilar" alone would also catch hair consultations.
    return t.includes("transplante") || (t.includes("cirurgia") && t.includes("capil"));
  });
}

export interface ProcedureType {
  id: number;
  /** Procedure names filed under this type, most used first. */
  procedimentos: string[];
  appointmentCount: number;
}

function procedureTypes(appointments: ClinicaNasNuvensAppointment[]): ProcedureType[] {
  const byType = new Map<number, { names: Map<string, number>; appointments: Set<number> }>();
  for (const appointment of appointments) {
    for (const p of appointment.procedimentos ?? []) {
      const entry = byType.get(p.idTipoProcedimento) ?? { names: new Map(), appointments: new Set() };
      entry.names.set(p.nome, (entry.names.get(p.nome) ?? 0) + 1);
      entry.appointments.add(appointment.id);
      byType.set(p.idTipoProcedimento, entry);
    }
  }
  return [...byType.entries()]
    .map(([id, { names, appointments }]) => ({
      id,
      procedimentos: [...names.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
      appointmentCount: appointments.size,
    }))
    .sort((a, b) => b.appointmentCount - a.appointmentCount);
}

/**
 * A 429 means the minute's quota was already spent (a page reload, or the
 * agenda sync cron running at the same time) — wait it out once.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ClinicaNasNuvensApiError && err.status === 429)) throw err;
    await sleep(RATE_LIMIT_RETRY_MS);
    return fn();
  }
}

function describe(appointment: ClinicaNasNuvensAppointment): Omit<HairTransplantSurgery, "paciente"> {
  return {
    codigo: appointment.id,
    data: appointment.data,
    horaInicio: appointment.horaInicio,
    procedimentos: (appointment.procedimentos ?? []).map((p) => `${p.nome} (tipo ${p.idTipoProcedimento})`).join(", "),
    tipoAtendimento: tipoAtendimento(appointment),
    observacoes: appointment.observacoes,
    status: appointment.status,
  };
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
export async function getHairTransplantSurgeries(month: string, tipos: number[] = []): Promise<HairTransplantSurgeriesResult> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", rows: [], appointmentCount: 0, procedureTypes: [], matchedByTipoAtendimento: false };
  }

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const appointments = await withRateLimitRetry(() =>
      client.listAppointments(`${month}-01`, lastDayOfMonth(month))
    );
    const surgeries = appointments
      .filter((a) => !CANCELLED_STATUSES.includes(a.status) && isHairTransplant(a, tipos))
      .sort((a, b) => `${a.data} ${a.horaInicio}`.localeCompare(`${b.data} ${b.horaInicio}`));

    const rows = await Promise.all(
      surgeries.map(async (appointment, i) => {
        await sleep((i + 1) * REQUEST_INTERVAL_MS);
        const paciente = await withRateLimitRetry(() =>
          client.getAppointmentSummary(appointment.id).then((s) => s.nomePaciente)
        );
        return { ...describe(appointment), paciente };
      })
    );
    return {
      status: "ok",
      rows,
      appointmentCount: appointments.length,
      procedureTypes: procedureTypes(appointments),
      matchedByTipoAtendimento: tipos.length > 0 || appointments.some((a) => tipoAtendimento(a) !== null),
    };
  } catch (err) {
    const errorMessage =
      err instanceof ClinicaNasNuvensApiError
        ? `${err.message} (status ${err.status}, body: ${JSON.stringify(err.body)})`
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      status: "error",
      rows: [],
      appointmentCount: 0,
      procedureTypes: [],
      matchedByTipoAtendimento: false,
      errorMessage,
    };
  }
}

export interface DayAppointment extends HairTransplantSurgery {
  profissional: string;
  isSurgery: boolean;
}

export interface DayAppointmentsResult {
  status: "ok" | "not_connected" | "error";
  rows: DayAppointment[];
  /** One appointment exactly as /agenda/lista returns it (contact info removed), to see its field names. */
  rawSample?: string;
  errorMessage?: string;
}

/**
 * Every CNN appointment on `date` (YYYY-MM-DD), cancelled ones included,
 * flagged with whether the month report counts it as a surgery — for
 * checking the report against what the clinic sees in its agenda.
 */
export async function getDayAppointments(date: string, tipos: number[] = []): Promise<DayAppointmentsResult> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", rows: [] };
  }

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const appointments = (await withRateLimitRetry(() => client.listAppointments(date, date))).sort((a, b) =>
      a.horaInicio.localeCompare(b.horaInicio)
    );
    await sleep(REQUEST_INTERVAL_MS);
    const executors = await withRateLimitRetry(() => client.listExecutors());
    const nameById = new Map(executors.map((e) => [e.idpessoa, e.nome]));

    const rows = await Promise.all(
      appointments.map(async (appointment, i) => {
        await sleep((i + 1) * REQUEST_INTERVAL_MS);
        const paciente = await withRateLimitRetry(() =>
          client.getAppointmentSummary(appointment.id).then((s) => s.nomePaciente)
        );
        return {
          ...describe(appointment),
          paciente,
          profissional: nameById.get(appointment.idPessoaExecutor) ?? `Profissional #${appointment.idPessoaExecutor}`,
          isSurgery: !CANCELLED_STATUSES.includes(appointment.status) && isHairTransplant(appointment, tipos),
        };
      })
    );
    const sample = appointments[0] && {
      ...appointments[0],
      telefoneCelularPaciente: undefined,
      emailPaciente: undefined,
      observacoes: undefined,
    };
    return { status: "ok", rows, rawSample: sample ? JSON.stringify(sample, null, 2) : undefined };
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
