import { getHairTransplantSurgeries, type HairTransplantSurgery } from "@/lib/report/hair-transplant-surgeries";
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
// month (defaults to the current one).
export default async function CirurgiasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { chave, mes } = await searchParams;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || chave !== cronSecret) {
    return (
      <div className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 px-6 py-16 dark:bg-black">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Acesso negado</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Abra esta página com o link que contém a chave.</p>
      </div>
    );
  }

  const month = typeof mes === "string" && /^\d{4}-\d{2}$/.test(mes) ? mes : todayIso().slice(0, 7);
  const result = await getHairTransplantSurgeries(month);
  const [year, monthNumber] = month.split("-");

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Cirurgias de transplante capilar — {monthNumber}/{year}
      </h1>

      <form className="flex items-center gap-2">
        <input type="hidden" name="chave" value={cronSecret} />
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
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    {HEADERS.map((header) => (
                      <th key={header} className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.codigo} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{formatDate(row.data)}</td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{row.paciente ?? ""}</td>
                      <td className="py-2 pr-4" />
                      <td className="py-2 pr-4" />
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
