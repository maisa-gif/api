import {
  getDayAppointments,
  getHairTransplantSurgeries,
  type HairTransplantSurgery,
} from "@/lib/report/hair-transplant-surgeries";
import { todayIso } from "@/lib/report/today";

// Fetches live from CNN on every visit; one name lookup per surgery is
// paced under CNN's 120 requests/minute limit.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEADERS = ["Data", "Paciente", "Valor", "Forma de pagamento"];

function formatDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}

/**
 * Semicolon-separated with a BOM so Excel in pt-BR opens it straight into
 * columns with accents intact. Valor and Forma de pagamento are left blank
 * on purpose — they're filled in by hand.
 */
function toCsvDataUri(rows: HairTransplantSurgery[]): string {
  const cell = (value: string | null) => `"${(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    HEADERS.map(cell).join(";"),
    ...rows.map((r) => [formatDate(r.data), r.paciente, "", ""].map(cell).join(";")),
  ];
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${lines.join("\r\n")}`)}`;
}

// Patient names are personal data and this app has no user auth, so the
// page only renders with ?chave=<CRON_SECRET>. ?mes=YYYY-MM picks the
// month (defaults to the current one); ?dia=YYYY-MM-DD instead lists that
// whole day's agenda, to check the report against it.
export default async function CirurgiasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { chave, mes, dia, tipos: tiposParam } = await searchParams;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || chave !== cronSecret) {
    return (
      <div className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 px-6 py-16 dark:bg-black">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Acesso negado</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Abra esta página com o link que contém a chave.</p>
      </div>
    );
  }

  // ?tipos=12&tipos=34 — procedure type ids (idTipoProcedimento) picked
  // on the page as the "Cirurgia Transplante Capilar" tipo de atendimento.
  const tipos = [tiposParam ?? []].flat().map(Number).filter(Number.isInteger);
  const tiposQuery = tipos.map((t) => `&tipos=${t}`).join("");

  if (typeof dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    return <DayView date={dia} cronSecret={cronSecret} tipos={tipos} tiposQuery={tiposQuery} />;
  }

  const month = typeof mes === "string" && /^\d{4}-\d{2}$/.test(mes) ? mes : todayIso().slice(0, 7);
  const result = await getHairTransplantSurgeries(month, tipos);
  const [year, monthNumber] = month.split("-");

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Cirurgias de transplante capilar — {monthNumber}/{year}
      </h1>

      <form className="flex items-center gap-2">
        <input type="hidden" name="chave" value={cronSecret} />
        {tipos.map((t) => (
          <input key={t} type="hidden" name="tipos" value={t} />
        ))}
        <input
          type="month"
          name="mes"
          defaultValue={month}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900">
          Ver mês
        </button>
      </form>
      <DayForm cronSecret={cronSecret} tipos={tipos} />

      <div className="w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
        {result.status === "not_connected" && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Clínica nas Nuvens não está conectada em Integrações.
          </p>
        )}
        {result.status === "error" && <p className="text-sm text-red-500">{result.errorMessage}</p>}
        {result.status === "ok" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {result.rows.length} cirurgia{result.rows.length === 1 ? "" : "s"} (cancelamentos não entram)
              </p>
              <a
                href={toCsvDataUri(result.rows)}
                download={`cirurgias-transplante-capilar-${month}.csv`}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
              >
                Baixar planilha
              </a>
            </div>
            {!result.matchedByTipoAtendimento && (
              <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                Nenhum tipo de atendimento selecionado: a lista foi montada pelo nome do procedimento e pode estar
                incompleta. Marque abaixo o(s) tipo(s) que correspondem à cirurgia de transplante capilar.
              </p>
            )}
            <details className="mt-4 text-sm" open={!result.matchedByTipoAtendimento}>
              <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">
                Tipos de atendimento do mês ({result.appointmentCount} agendamentos)
              </summary>
              <form className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="chave" value={cronSecret} />
                <input type="hidden" name="mes" value={month} />
                {result.procedureTypes.map((type) => (
                  <label key={type.id} className="flex items-start gap-2 text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" name="tipos" value={type.id} defaultChecked={tipos.includes(type.id)} className="mt-1" />
                    <span>
                      <strong>Tipo {type.id}</strong> — {type.appointmentCount} agendamentos:{" "}
                      {type.procedimentos.slice(0, 8).join(", ")}
                      {type.procedimentos.length > 8 ? ", ..." : ""}
                    </span>
                  </label>
                ))}
                <button
                  type="submit"
                  className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
                >
                  Usar tipos marcados
                </button>
              </form>
            </details>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    {["Data", "Hora", "Paciente", "Tipo de atendimento", "Procedimento / observação", "Status"].map((header) => (
                      <th key={header} className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.codigo} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        <a className="underline" href={`?chave=${encodeURIComponent(cronSecret)}&dia=${row.data}${tiposQuery}`}>
                          {formatDate(row.data)}
                        </a>
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{row.horaInicio.slice(0, 5)}</td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{row.paciente ?? ""}</td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{row.tipoAtendimento ?? ""}</td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {[row.procedimentos, row.observacoes].filter(Boolean).join(" — ")}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DayForm({ cronSecret, tipos, date }: { cronSecret: string; tipos: number[]; date?: string }) {
  return (
    <form className="flex items-center gap-2">
      <input type="hidden" name="chave" value={cronSecret} />
      {tipos.map((t) => (
        <input key={t} type="hidden" name="tipos" value={t} />
      ))}
      <input
        type="date"
        name="dia"
        defaultValue={date}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900">
        Ver agenda do dia
      </button>
    </form>
  );
}

async function DayView({
  date,
  cronSecret,
  tipos,
  tiposQuery,
}: {
  date: string;
  cronSecret: string;
  tipos: number[];
  tiposQuery: string;
}) {
  const result = await getDayAppointments(date, tipos);

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Agenda de {formatDate(date)}</h1>
      <DayForm cronSecret={cronSecret} tipos={tipos} date={date} />
      <a className="text-sm underline" href={`?chave=${encodeURIComponent(cronSecret)}&mes=${date.slice(0, 7)}${tiposQuery}`}>
        Voltar para o relatório do mês
      </a>

      <div className="w-full max-w-6xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
        {result.status === "not_connected" && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Clínica nas Nuvens não está conectada em Integrações.
          </p>
        )}
        {result.status === "error" && <p className="text-sm text-red-500">{result.errorMessage}</p>}
        {result.status === "ok" && (
          <>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {result.rows.length} agendamentos — em verde, os que entram no relatório de cirurgias.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    {["Código", "Hora", "Paciente", "Profissional", "Tipo de atendimento", "Procedimento", "Observação", "Status"].map((header) => (
                      <th key={header} className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr
                      key={row.codigo}
                      className={`border-b border-zinc-100 text-zinc-700 dark:border-zinc-900 dark:text-zinc-300 ${
                        row.isSurgery ? "bg-emerald-50 dark:bg-emerald-950" : ""
                      }`}
                    >
                      <td className="py-2 pr-4">{row.codigo}</td>
                      <td className="py-2 pr-4">{row.horaInicio.slice(0, 5)}</td>
                      <td className="py-2 pr-4">{row.paciente ?? ""}</td>
                      <td className="py-2 pr-4">{row.profissional}</td>
                      <td className="py-2 pr-4">{row.tipoAtendimento ?? ""}</td>
                      <td className="py-2 pr-4">{row.procedimentos}</td>
                      <td className="py-2 pr-4">{row.observacoes ?? ""}</td>
                      <td className="py-2 pr-4">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.rawSample && (
              <details className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
                <summary className="cursor-pointer">Campos enviados pelo Clínica nas Nuvens (1º agendamento)</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-100 p-3 dark:bg-zinc-950">{result.rawSample}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
