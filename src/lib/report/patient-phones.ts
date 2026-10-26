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

export interface PatientPhone {
  codigo: number;
  data: string | null;
  paciente: string | null;
  telefone: string | null;
  email: string | null;
  found: boolean;
}

export interface PatientPhonesResult {
  status: "ok" | "not_connected" | "error";
  rows: PatientPhone[];
  errorMessage?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` over `items`, starting one call every REQUEST_INTERVAL_MS. */
function paced<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  return Promise.all(
    items.map(async (item, i) => {
      await sleep(i * REQUEST_INTERVAL_MS);
      try {
        return await fn(item);
      } catch (err) {
        // A 429 means the minute's quota was already spent (e.g. a page
        // reload right after a previous run) — wait it out once.
        if (!(err instanceof ClinicaNasNuvensApiError && err.status === 429)) throw err;
        await sleep(RATE_LIMIT_RETRY_MS);
        return fn(item);
      }
    })
  );
}

/**
 * Looks up the patient's phone/email for each CNN appointment id (the
 * "Código" column of CNN's agenda reports). /agenda/{id}/resumida has the
 * name and date but no contact info, so the phone comes from that day's
 * /agenda/lista.
 */
export async function getPatientPhones(codigos: number[]): Promise<PatientPhonesResult> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", rows: [] };
  }

  try {
    const client = new ClinicaNasNuvensClient(cnnStatus.token);
    const summaries = await paced(codigos, (id) =>
      client.getAppointmentSummary(id).catch((err): ClinicaNasNuvensAppointmentSummary | null => {
        if (err instanceof ClinicaNasNuvensApiError && err.status === 404) return null;
        throw err;
      })
    );

    const dates = [...new Set(summaries.flatMap((s) => (s ? [s.data] : [])))];
    const byId = new Map<number, ClinicaNasNuvensAppointment>();
    for (const list of await paced(dates, (d) => client.listAppointments(d, d))) {
      for (const appointment of list) byId.set(appointment.id, appointment);
    }

    const rows = codigos.map((codigo, i) => {
      const summary = summaries[i];
      const appointment = byId.get(codigo);
      return {
        codigo,
        data: summary?.data ?? null,
        paciente: summary?.nomePaciente ?? null,
        telefone: appointment?.telefoneCelularPaciente ?? null,
        email: appointment?.emailPaciente ?? null,
        found: Boolean(summary),
      };
    });
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
