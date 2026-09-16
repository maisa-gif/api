import { getValidContaAzulAccessToken } from "./connection";

/**
 * Client for the Conta Azul financial API (api-v2.contaazul.com).
 *
 * Confirmed by live testing against a real sandbox app (developers.contaazul.com
 * is blocked by this environment's network egress, so this couldn't be checked
 * against the OpenAPI spec directly):
 * - Base path is `/v1/financeiro/eventos-financeiros/{contas-a-receber,contas-a-pagar}/buscar`.
 * - `data_vencimento_de`/`data_vencimento_ate` (YYYY-MM-DD) are required on
 *   every call, even when filtering by payment date instead — pass a wide
 *   static range to effectively not filter by due date.
 * - `data_pagamento_de`/`data_pagamento_ate` filter by actual settlement
 *   date and are what "paid/received on day X" should use.
 * - There's no working `status` filter value — QUITADO, PAID, and pago all
 *   get rejected with a generic "formato do parâmetro fornecido é inválido"
 *   (confirmed against a live sandbox token). Filtering by data_pagamento
 *   alone is enough: an item only matches that filter once it has an actual
 *   payment date, so no separate settled/paid filter is needed.
 * - Response shape is `{ itens_totais, itens: [...], totais: {...} }`, not
 *   the `{ itens: [...] }` originally assumed.
 * - Each item has `total` (invoice amount) and `pago` (amount actually
 *   paid so far) — not a single `valor` field — plus an English `status`
 *   (e.g. "PENDING") with a `status_traduzido` Portuguese label. There's no
 *   per-item payment-date field visible on the unpaid sandbox items tested,
 *   so it's unconfirmed whether `pago` on an item matching a narrow
 *   data_pagamento window reflects only that day's payment or a running
 *   total — sanity-check this against the real Conta Azul dashboard once
 *   connected to a live (non-sandbox) account with real paid entries.
 */
const BASE_URL = "https://api-v2.contaazul.com";
const RECEIVABLES_SEARCH_PATH = "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar";
const PAYABLES_SEARCH_PATH = "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar";
// data_vencimento_de/ate are mandatory query params even though we only
// care about data_pagamento here, so pass a range wide enough to never
// exclude anything by due date.
const WIDE_DUE_DATE_RANGE = { data_vencimento_de: "2000-01-01", data_vencimento_ate: "2100-12-31" };

export interface ContaAzulFinancialEvent {
  id: string;
  descricao: string;
  total: number;
  pago: number;
  nao_pago: number;
  data_vencimento: string;
  status: string;
  status_traduzido: string;
}

interface ContaAzulSearchResponse {
  itens_totais: number;
  itens: ContaAzulFinancialEvent[];
  totais: Record<string, { valor: number } | number>;
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

/** Financial events (payable or receivable) with a payment recorded on exactly `date` (YYYY-MM-DD). */
async function searchPaidOn(path: string, date: string): Promise<ContaAzulFinancialEvent[]> {
  const params = new URLSearchParams({
    ...WIDE_DUE_DATE_RANGE,
    data_pagamento_de: date,
    data_pagamento_ate: date,
  });
  return request(path, params);
}

export async function getReceivedOn(date: string): Promise<ContaAzulFinancialEvent[]> {
  return searchPaidOn(RECEIVABLES_SEARCH_PATH, date);
}

export async function getPaidOn(date: string): Promise<ContaAzulFinancialEvent[]> {
  return searchPaidOn(PAYABLES_SEARCH_PATH, date);
}

/**
 * Financial events (payable or receivable) still owed (`nao_pago > 0`) and
 * due between `fromDate` and `toDate` inclusive (YYYY-MM-DD) — this time
 * `data_vencimento_de`/`ate` is the real filter, not a bypass range, since
 * "a vencer" is about the due date, not the payment date.
 */
async function searchDueBetween(path: string, fromDate: string, toDate: string): Promise<ContaAzulFinancialEvent[]> {
  const params = new URLSearchParams({ data_vencimento_de: fromDate, data_vencimento_ate: toDate });
  const events = await request(path, params);
  return events.filter((e) => e.nao_pago > 0);
}

export async function getReceivablesDueBetween(fromDate: string, toDate: string): Promise<ContaAzulFinancialEvent[]> {
  return searchDueBetween(RECEIVABLES_SEARCH_PATH, fromDate, toDate);
}

export async function getPayablesDueBetween(fromDate: string, toDate: string): Promise<ContaAzulFinancialEvent[]> {
  return searchDueBetween(PAYABLES_SEARCH_PATH, fromDate, toDate);
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
