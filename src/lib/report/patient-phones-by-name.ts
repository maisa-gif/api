import { getIntegrationStatus } from "@/lib/integrations/service";
import {
  ClinicaNasNuvensClient,
  ClinicaNasNuvensApiError,
  type ClinicaNasNuvensPatient,
} from "@/lib/integrations/clinica-nas-nuvens/client";

// CNN rejects more than 120 requests/minute (429), so calls are spaced to
// stay at ~100/minute.
const REQUEST_INTERVAL_MS = 600;
const RATE_LIMIT_RETRY_MS = 60_000;
// Stops starting new CNN calls before Vercel's 300s maxDuration kills the
// request, so the rows done so far still come back.
const TIME_BUDGET_MS = 270_000;
const NAME_STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e"]);

export interface NameLookupInput {
  aba: string;
  nome: string;
  /** Surgery date as written in the sheet; passed through to the CSV only. */
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

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Name words as typed (accents kept), minus prepositions and initials. */
function nameWords(name: string): string[] {
  return name.split(/[^\p{L}]+/u).filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w.toLowerCase()));
}

const nameTokens = (name: string) => nameWords(name).map((w) => stripAccents(w).toLowerCase());

/** How many of the sheet name's words appear in the registered name. */
function sharedTokens(sheetName: string, cnnName: string): number {
  const cnn = new Set(nameTokens(cnnName));
  return nameTokens(sheetName).filter((t) => cnn.has(t)).length;
}

/**
 * Sheet names are often shortened ("Jose Augusto Mello" for "José Augusto
 * Santos de Mello", or just a first name), so two shared words are enough
 * for a multi-word name and one for a single word.
 */
function isMatch(sheetName: string, cnnName: string): boolean {
  const sheetTokenCount = nameTokens(sheetName).length;
  return sheetTokenCount > 0 && sharedTokens(sheetName, cnnName) >= Math.min(2, sheetTokenCount);
}

function phoneOf(patient: ClinicaNasNuvensPatient): string | null {
  const c = patient.contato;
  return c?.telefoneCelular || c?.telefoneResidencial || c?.telefoneRecados || c?.telefoneComercial || null;
}

/**
 * Finds each patient's phone/email in CNN's patient registry by name, for
 * spreadsheets that list patients by (often shortened) name rather than
 * CNN appointment codes, keeping the registered patients that share the
 * most words with the sheet's name.
 */
export async function getPatientPhonesByName(inputs: NameLookupInput[]): Promise<NameLookupResult> {
  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return { status: "not_connected", rows: [] };
  }

  const client = new ClinicaNasNuvensClient(cnnStatus.token);
  const limited = createLimiter(Date.now() + TIME_BUDGET_MS);
  const searchCache = new Map<string, Promise<ClinicaNasNuvensPatient[]>>();
  const search = (term: string) => {
    if (!searchCache.has(term)) searchCache.set(term, limited(() => client.searchPatients(term)));
    return searchCache.get(term)!;
  };

  async function lookup(input: NameLookupInput): Promise<NameLookupRow> {
    const empty = { ...input, nomeClinica: null, telefone: null, email: null };
    const words = nameWords(input.nome);
    if (words.length === 0) return { ...empty, observacao: "nome vazio" };

    // The full name as typed usually hits directly; otherwise fall back to
    // its longest word (accented and not, since it's unknown whether
    // nomeContem ignores accents).
    const longest = [...words].sort((a, b) => b.length - a.length)[0];
    const terms = [...new Set([words.join(" "), longest, stripAccents(longest)])];
    try {
      let matches: ClinicaNasNuvensPatient[] = [];
      for (const term of terms) {
        matches = (await search(term)).filter((p) => isMatch(input.nome, p.nome));
        if (matches.length > 0) break;
      }
      if (matches.length === 0) return { ...empty, observacao: "não encontrado no cadastro" };

      const best = Math.max(...matches.map((p) => sharedTokens(input.nome, p.nome)));
      const [first, ...others] = matches.filter((p) => sharedTokens(input.nome, p.nome) === best);
      return {
        ...input,
        nomeClinica: first.nome,
        telefone: phoneOf(first),
        email: first.contato?.email ?? null,
        observacao: others.length > 0 ? `conferir — também: ${others.map((p) => p.nome).join(", ")}` : "",
      };
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
