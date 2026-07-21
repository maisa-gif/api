import { getClinicaNasNuvensEnvConfig } from "./config";

/**
 * Client for the Clínica nas Nuvens public API, confirmed against the
 * real API (via its unauthenticated /v2/api-docs Swagger spec, plus a
 * real GET /agenda/lista call):
 *
 * - No OAuth2 token-exchange step exists — every request authenticates
 *   directly with HTTP Basic auth (client_id as username, client_secret
 *   as password) plus the clinicaNasNuvens-cid header carrying the
 *   per-clinic token/hash shown in the settings panel.
 * - Base URL has no path prefix (Swagger basePath is "/").
 * - dataInicial/dataFinal on /agenda/lista are required and must be
 *   ISO format (yyyy-MM-dd) — the API 400s on dd/MM/yyyy.
 */

const CID_HEADER = "clinicaNasNuvens-cid";
const AGENDA_LISTA_PATH = "/agenda/lista";
const AGENDA_RESUMIDA_PATH = (id: number) => `/agenda/${id}/resumida`;
// Server-observed max in testing; loop pages beyond this if totalPaginas > 1.
const PAGE_SIZE = 200;

export interface ClinicaNasNuvensProcedimento {
  id: number;
  idTipoProcedimento: number;
  nome: string;
  quantidade: number;
}

/** Shape of an item in GET /agenda/lista's `lista` array. */
export interface ClinicaNasNuvensAppointment {
  id: number;
  idPaciente: number;
  idPessoaExecutor: number;
  idLocalAgenda: number;
  status: string;
  /** ISO date, e.g. "2026-07-21" */
  data: string;
  /** "HH:mm:ss" */
  horaInicio: string;
  /** "HH:mm:ss" */
  horaFim: string;
  observacoes: string | null;
  telefoneCelularPaciente: string | null;
  emailPaciente: string | null;
  procedimentos: ClinicaNasNuvensProcedimento[];
}

interface ClinicaNasNuvensAgendaListaResponse {
  pagina: number;
  totalPaginas: number;
  lista: ClinicaNasNuvensAppointment[];
}

/** Shape of GET /agenda/{id}/resumida — has the patient name, unlike /agenda/lista. */
export interface ClinicaNasNuvensAppointmentSummary {
  id: number;
  nomePaciente: string;
  status: string;
  data: string;
  horaInicial: string;
  horaFinal: string;
}

export class ClinicaNasNuvensApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
  }
}

/**
 * `cid` is the per-clinic token/hash shown as "Token/Hash
 * (clinicaNasNuvens-cid)" in the integration settings panel — it identifies
 * which clinic account the calls are made on behalf of, distinct from the
 * app-level client_id/client_secret credentials.
 */
export class ClinicaNasNuvensClient {
  constructor(private readonly cid: string) {
    if (!cid) {
      throw new Error("ClinicaNasNuvensClient requires a non-empty cid token/hash.");
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { baseUrl, clientId, clientSecret } = getClinicaNasNuvensEnvConfig();
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Basic ${basicAuth}`,
        [CID_HEADER]: this.cid,
      },
    });

    if (!response.ok) {
      throw new ClinicaNasNuvensApiError(
        `Clínica nas Nuvens request to ${path} failed`,
        response.status,
        await safeReadBody(response)
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Lists every agenda appointment between `from` and `to` (inclusive),
   * ISO date strings (YYYY-MM-DD), paginating through all pages.
   * `executorId` filters to a single professional (codigoPessoaExecutor).
   */
  async listAppointments(
    from: string,
    to: string,
    executorId?: number
  ): Promise<ClinicaNasNuvensAppointment[]> {
    const all: ClinicaNasNuvensAppointment[] = [];
    let pagina = 0;
    let totalPaginas = 1;

    do {
      const params = new URLSearchParams({
        dataInicial: from,
        dataFinal: to,
        pagina: String(pagina),
        registrosPorPagina: String(PAGE_SIZE),
      });
      if (executorId !== undefined) {
        params.set("codigoPessoaExecutor", String(executorId));
      }
      const page = await this.request<ClinicaNasNuvensAgendaListaResponse>(
        `${AGENDA_LISTA_PATH}?${params.toString()}`
      );
      all.push(...page.lista);
      totalPaginas = page.totalPaginas;
      pagina += 1;
    } while (pagina < totalPaginas);

    return all;
  }

  /** Fetches the patient name + a condensed status for a single appointment. */
  async getAppointmentSummary(id: number): Promise<ClinicaNasNuvensAppointmentSummary> {
    return this.request<ClinicaNasNuvensAppointmentSummary>(AGENDA_RESUMIDA_PATH(id));
  }

  /** Sanity-checks the credentials + cid by making a lightweight call. */
  async testConnection(): Promise<boolean> {
    try {
      await this.request(`${AGENDA_LISTA_PATH}?${new URLSearchParams({
        dataInicial: new Date().toISOString().slice(0, 10),
        dataFinal: new Date().toISOString().slice(0, 10),
        pagina: "0",
        registrosPorPagina: "1",
      }).toString()}`);
      return true;
    } catch {
      return false;
    }
  }
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
