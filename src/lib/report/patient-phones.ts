import { getIntegrationStatus } from "@/lib/integrations/service";
import {
  ClinicaNasNuvensClient,
  ClinicaNasNuvensApiError,
  type ClinicaNasNuvensAppointment,
  type ClinicaNasNuvensAppointmentSummary,
} from "@/lib/integrations/clinica-nas-nuvens/client";

// Keeps the per-appointment CNN calls from tripping rate limits.
const CONCURRENCY = 5;

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

async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
  }
  return results;
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
    const summaries = await inBatches(codigos, (id) =>
      client.getAppointmentSummary(id).catch((err): ClinicaNasNuvensAppointmentSummary | null => {
        if (err instanceof ClinicaNasNuvensApiError && err.status === 404) return null;
        throw err;
      })
    );

    const dates = [...new Set(summaries.flatMap((s) => (s ? [s.data] : [])))];
    const byId = new Map<number, ClinicaNasNuvensAppointment>();
    for (const list of await inBatches(dates, (d) => client.listAppointments(d, d))) {
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
