import {
  ClinicaNasNuvensApiError,
  ClinicaNasNuvensClient,
  type ClinicaNasNuvensAppointment,
} from "@/lib/integrations/clinica-nas-nuvens/client";
import { getIntegrationStatus } from "@/lib/integrations/service";
import { BitrixApiError, BitrixClient, type BitrixDealStage } from "@/lib/integrations/bitrix/client";
import { hasBitrixConfig } from "@/lib/integrations/bitrix/config";
import { DEAL_CATEGORY_ID } from "@/lib/sync/drive-transcripts-bitrix";

// Same professional filter used by the agenda sync
// (src/lib/sync/clinica-nas-nuvens-google-calendar.ts) — unset syncs/shows
// every professional's appointments.
const EXECUTOR_ID = process.env.CLINICA_NAS_NUVENS_EXECUTOR_ID
  ? Number(process.env.CLINICA_NAS_NUVENS_EXECUTOR_ID)
  : undefined;
const UPCOMING_WINDOW_DAYS = 7;

function describeError(err: unknown): string {
  if (err instanceof ClinicaNasNuvensApiError || err instanceof BitrixApiError) {
    return `${err.message} (status ${err.status})`;
  }
  return err instanceof Error ? err.message : String(err);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface AgendaAppointment {
  id: number;
  patientName: string;
  status: string;
  horaInicio: string;
  horaFim: string;
  procedimentos: string;
}

export interface AgendaSummary {
  configured: boolean;
  error: string | null;
  today: AgendaAppointment[];
  upcomingCount: number;
  upcomingWindowDays: number;
}

/**
 * Today's appointments (enriched with patient names, one summary call per
 * appointment — bounded to a single day so this stays cheap) plus a plain
 * count of appointments in the following week (no per-appointment calls,
 * since only the total is shown).
 */
export async function getAgendaSummary(): Promise<AgendaSummary> {
  const empty: AgendaSummary = {
    configured: false,
    error: null,
    today: [],
    upcomingCount: 0,
    upcomingWindowDays: UPCOMING_WINDOW_DAYS,
  };

  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return empty;
  }

  const client = new ClinicaNasNuvensClient(cnnStatus.token);
  const now = new Date();
  const todayIso = isoDate(now);
  const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const [todayAppointments, upcomingAppointments] = await Promise.all([
      client.listAppointments(todayIso, todayIso, EXECUTOR_ID),
      client.listAppointments(isoDate(now), isoDate(windowEnd), EXECUTOR_ID),
    ]);

    const today = await Promise.all(
      sortByStartTime(todayAppointments).map(async (appointment) => ({
        id: appointment.id,
        patientName: await resolvePatientName(client, appointment),
        status: appointment.status,
        horaInicio: appointment.horaInicio.slice(0, 5),
        horaFim: appointment.horaFim.slice(0, 5),
        procedimentos: appointment.procedimentos.map((p) => p.nome).join(", "),
      }))
    );

    return {
      configured: true,
      error: null,
      today,
      upcomingCount: upcomingAppointments.length,
      upcomingWindowDays: UPCOMING_WINDOW_DAYS,
    };
  } catch (err) {
    return { ...empty, configured: true, error: describeError(err) };
  }
}

function sortByStartTime(appointments: ClinicaNasNuvensAppointment[]) {
  return [...appointments].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
}

async function resolvePatientName(
  client: ClinicaNasNuvensClient,
  appointment: ClinicaNasNuvensAppointment
): Promise<string> {
  try {
    const summary = await client.getAppointmentSummary(appointment.id);
    return summary.nomePaciente || "Paciente sem nome";
  } catch {
    return "Paciente sem nome";
  }
}

export interface PipelineStage {
  id: string;
  name: string;
  count: number;
  percent: number;
}

export interface PipelineSummary {
  configured: boolean;
  error: string | null;
  totalDeals: number;
  stages: PipelineStage[];
}

/** Open-deal counts per stage of the "Funil Comercial" Bitrix24 pipeline. */
export async function getPipelineSummary(): Promise<PipelineSummary> {
  const empty: PipelineSummary = { configured: false, error: null, totalDeals: 0, stages: [] };

  if (!hasBitrixConfig()) {
    return empty;
  }

  const client = new BitrixClient();

  try {
    const [stageDefs, deals] = await Promise.all([
      client.listDealStages(DEAL_CATEGORY_ID),
      client.listOpenDealsByCategory(DEAL_CATEGORY_ID),
    ]);

    const countsByStage = new Map<string, number>();
    for (const deal of deals) {
      countsByStage.set(deal.STAGE_ID, (countsByStage.get(deal.STAGE_ID) ?? 0) + 1);
    }

    const stages = orderStages(stageDefs).map((stage) => {
      const count = countsByStage.get(stage.STATUS_ID) ?? 0;
      return {
        id: stage.STATUS_ID,
        name: stage.NAME,
        count,
        percent: deals.length > 0 ? Math.round((count / deals.length) * 100) : 0,
      };
    });

    return { configured: true, error: null, totalDeals: deals.length, stages };
  } catch (err) {
    return { ...empty, configured: true, error: describeError(err) };
  }
}

function orderStages(stages: BitrixDealStage[]) {
  return [...stages].sort((a, b) => Number(a.SORT ?? 0) - Number(b.SORT ?? 0));
}
