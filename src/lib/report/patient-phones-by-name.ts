import { getIntegrationStatus } from "@/lib/integrations/service";
import {
  ClinicaNasNuvensClient,
  ClinicaNasNuvensApiError,
  type ClinicaNasNuvensAppointment,
  type ClinicaNasNuvensAppointmentSummary,
} from "@/lib/integrations/clinica-nas-nuvens/client";

// CNN rejects more than 120 requests/minute (429), so calls are spaced to
// stay at ~100/minute.
const REQUEST_INTERVAL_MS = 600;
const RATE_LIMIT_RETRY_MS = 60_000;
// Stops starting new CNN calls before Vercel's 300s maxDuration kills the
// request, so the rows done so far still come back.
const TIME_BUDGET_MS = 270_000;
// Appointment summaries (the only place the patient name lives) fetched per
// row before giving up on a date that has many appointments.
const MAX_SUMMARIES_PER_ROW = 20;
const SURGERY_PROCEDURE = /cirurg|transplant|implante/i;
const NAME_STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e"]);

export interface NameLookupInput {
  aba: string;
  nome: string;
  /** "dd/MM/yyyy", or "" when the sheet row has no surgery date. */
  data: string;
}

export interface NameLookupRow extends NameLookupInput {
  nomeClinica: string | null;
  telefone: string | null;
  email: string | null;
  observacao: string;
}

export interface NameLookupResult {
  status: "ok" | "not_connected" | "error";
  rows: NameLookupRow[];
  errorMessage?: string;
}

class OutOfTimeError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serializes call start times REQUEST_INTERVAL_MS apart across all callers. */
function createLimiter(deadline: number) {
  let nextSlot = Date.now();
  return async function limited<T>(fn: () => Promise<T>): Promise<T> {
    const slot = Math.max(nextSlot, Date.now());
    nextSlot = slot + REQUEST_INTERVAL_MS;
    if (slot > deadline) throw new OutOfTimeError();
    await sleep(slot - Date.now());
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ClinicaNasNuvensApiError && err.status === 429)) throw err;
      if (Date.now() + RATE_LIMIT_RETRY_MS > deadline) throw new OutOfTimeError();
      await sleep(RATE_LIMIT_RETRY_MS);
      return fn();
    }
  };
}

function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t));
}

/**
 * Sheet names are often shortened ("Jose Augusto Mello" for "José Augusto
 * Santos de Mello", or just a first name), so two shared tokens are enough
 * for a multi-word name and one for a single word.
 */
function namesMatch(sheetName: string, cnnName: string): boolean {
  const sheet = nameTokens(sheetName);
  const cnn = new Set(nameTokens(cnnName));
  const shared = sheet.filter((t) => cnn.has(t)).length;
  return sheet.length > 0 && shared >= Math.min(2, sheet.length);
}

/** "dd/MM/yyyy" → "yyyy-MM-dd", the only format /agenda/lista accepts. */
function toIso(date: string): string {
  const [day, month, year] = date.split("/");
  return `${year}-${month}-${day}`;
}

/**
 * Finds each patient's phone/email by listing CNN appointments on their
 * surgery date and matching the patient name, for spreadsheets that only
 * have "name + surgery date" rather than CNN appointment codes.
 */
export async function getPatientPhonesByName(inputs: NameLookupInput[]): Promise<NameLookupResult> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", rows: [] };
  }

  const client = new ClinicaNasNuvensClient(cnnStatus.token);
  const limited = createLimiter(Date.now() + TIME_BUDGET_MS);
  const dayCache = new Map<string, Promise<ClinicaNasNuvensAppointment[]>>();
  const summaryCache = new Map<number, Promise<ClinicaNasNuvensAppointmentSummary>>();

  const listDay = (iso: string) => {
    if (!dayCache.has(iso)) dayCache.set(iso, limited(() => client.listAppointments(iso, iso)));
    return dayCache.get(iso)!;
  };
  const summarize = (id: number) => {
    if (!summaryCache.has(id)) summaryCache.set(id, limited(() => client.getAppointmentSummary(id)));
    return summaryCache.get(id)!;
  };

  async function lookup(input: NameLookupInput): Promise<NameLookupRow> {
    const empty = { ...input, nomeClinica: null, telefone: null, email: null };
    if (!input.data) return { ...empty, observacao: "sem data na planilha" };

    try {
      const appointments = await listDay(toIso(input.data));
      // Surgery appointments first: the sheet's date is the surgery date.
      const candidates = [
        ...appointments.filter((a) => a.procedimentos.some((p) => SURGERY_PROCEDURE.test(p.nome))),
        ...appointments.filter((a) => !a.procedimentos.some((p) => SURGERY_PROCEDURE.test(p.nome))),
      ].slice(0, MAX_SUMMARIES_PER_ROW);

      for (const appointment of candidates) {
        const summary = await summarize(appointment.id);
        if (namesMatch(input.nome, summary.nomePaciente)) {
          return {
            ...input,
            nomeClinica: summary.nomePaciente,
            telefone: appointment.telefoneCelularPaciente,
            email: appointment.emailPaciente,
            observacao: "",
          };
        }
      }
      return { ...empty, observacao: "não encontrado nessa data" };
    } catch (err) {
      if (err instanceof OutOfTimeError) return { ...empty, observacao: "não deu tempo — busque de novo só estes" };
      throw err;
    }
  }

  try {
    return { status: "ok", rows: await Promise.all(inputs.map(lookup)) };
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
