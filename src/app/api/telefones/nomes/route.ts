import { getPatientPhonesByName, type NameLookupInput } from "@/lib/report/patient-phones-by-name";

// The name lookup paces CNN calls under its 120 requests/minute limit, so
// ~70 rows take a couple of minutes.
export const maxDuration = 300;

/**
 * Form POST from /telefones ("Buscar por nome"): `chave` must equal
 * CRON_SECRET since the response holds patient data; `linhas` has one
 * "aba;nome;dd/MM/yyyy" per line. POST (not a GET page) keeps patient
 * names out of URLs and access logs. Responds with a CSV download.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || form.get("chave") !== cronSecret) {
    return new Response("Acesso negado.", { status: 401 });
  }

  const inputs: NameLookupInput[] = String(form.get("linhas") ?? "")
    .split(/\r?\n/)
    .map((line) => line.split(";").map((part) => part.trim()))
    .filter(([, nome]) => Boolean(nome))
    .map(([aba, nome, data = ""]) => ({ aba, nome, data }));
  if (inputs.length === 0) {
    return new Response("Nenhuma linha colada.", { status: 400 });
  }

  const result = await getPatientPhonesByName(inputs);
  if (result.status === "not_connected") {
    return new Response("Clínica nas Nuvens não está conectada em Integrações.", { status: 502 });
  }
  if (result.status === "error") {
    return new Response(result.errorMessage, { status: 502 });
  }

  // Semicolons + BOM so Excel in pt-BR opens it straight into columns.
  const cell = (value: string | null) => `"${(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["Aba", "Nome na planilha", "Data da cirurgia", "Nome no Clínica nas Nuvens", "Telefone", "E-mail", "Observação"],
    ...result.rows.map((r) => [r.aba, r.nome, r.data, r.nomeClinica, r.telefone, r.email, r.observacao]),
  ]
    .map((row) => row.map(cell).join(";"))
    .join("\r\n");

  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="telefones-por-nome.csv"',
    },
  });
}
