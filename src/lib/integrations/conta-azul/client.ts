import { getValidContaAzulAccessToken } from "./connection";

/**
 * Client for the Conta Azul financial API (api-v2.contaazul.com), confirmed
 * against https://developers.contaazul.com/docs/financial-apis-openapi via
 * search results only — developers.contaazul.com is blocked by this
 * environment's network egress proxy, so the exact query parameter names
 * below (especially the settlement/payment-date filter, as opposed to the
 * due-date filter) were NOT verified against the live OpenAPI spec.
 *
 * Once Conta Azul is connected, sanity-check a real response against the
 * Conta Azul web dashboard for the same day before trusting this for the
 * daily report, and adjust the query params here if they don't match.
 */
const BASE_URL = "https://api-v2.contaazul.com";
const RECEIVABLES_SEARCH_PATH = "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar";
const PAYABLES_SEARCH_PATH = "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar";
// Conta Azul's settled status for a fully paid/received entry.
const SETTLED_STATUS = "QUITADO";

export interface ContaAzulFinancialEvent {
  id: string;
  descricao: string;
  valor: number;
  data_vencimento: string;
  data_pagamento?: string;
  status: string;
}

interface ContaAzulSearchResponse {
  itens: ContaAzulFinancialEvent[];
}

export class ContaAzulApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
  }
}

async function request(path: string, params: URLSearchParams): Promise<ContaAzulFinancialEvent[]> {
  const accessToken = await getValidContaAzulAccessToken();

  const response = await fetch(`${BASE_URL}${path}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new ContaAzulApiError(`Conta Azul request to ${path} failed`, response.status, await safeReadBody(response));
  }

  const data = (await response.json()) as ContaAzulSearchResponse;
  return data.itens ?? [];
}

/** Financial events (payable or receivable) settled on exactly `date` (YYYY-MM-DD). */
async function searchSettledOn(path: string, date: string): Promise<ContaAzulFinancialEvent[]> {
  const params = new URLSearchParams({
    data_vencimento_de: date,
    data_vencimento_ate: date,
    status: SETTLED_STATUS,
  });
  const events = await request(path, params);
  // Belt-and-braces filter in case the API's date filter is by due date
  // rather than settlement date (see the caveat above) and returns a wider
  // window than requested.
  return events.filter((e) => e.data_pagamento === date);
}

export async function getReceivedOn(date: string): Promise<ContaAzulFinancialEvent[]> {
  return searchSettledOn(RECEIVABLES_SEARCH_PATH, date);
}

export async function getPaidOn(date: string): Promise<ContaAzulFinancialEvent[]> {
  return searchSettledOn(PAYABLES_SEARCH_PATH, date);
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
