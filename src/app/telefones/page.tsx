import { getPatientPhones } from "@/lib/report/patient-phones";

// Fetches live from CNN on every visit.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Patient phone numbers are personal data and this app has no user auth,
// so the page only renders with ?chave=<CRON_SECRET>. Appointment ids
// ("Código" in CNN reports) come in as ?codigos=1,2,3 so no patient data
// lives in the repo.
export default async function TelefonesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { chave, codigos: codigosParam } = await searchParams;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || chave !== cronSecret) {
    return (
      <div className="flex flex-1 flex-col items-center gap-4 bg-zinc-50 px-6 py-16 dark:bg-black">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Acesso negado</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Abra esta página com o link que contém a chave.</p>
      </div>
    );
  }

  const codigos = [...new Set(String(codigosParam ?? "").match(/\d+/g)?.map(Number) ?? [])];
  if (codigos.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Telefones de pacientes</h1>
        <form className="flex w-full max-w-2xl flex-col gap-4">
          <input type="hidden" name="chave" value={cronSecret} />
          <label className="text-sm text-zinc-500 dark:text-zinc-400" htmlFor="codigos">
            Cole os códigos dos agendamentos (um por linha ou separados por vírgula):
          </label>
          <textarea
            id="codigos"
            name="codigos"
            rows={10}
            className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900">
            Buscar telefones
          </button>
        </form>
      </div>
    );
  }

  const result = await getPatientPhones(codigos);
  const notFound = result.rows.filter((r) => !r.found).length;

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Telefones de pacientes</h1>

      <div className="w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
        {result.status === "not_connected" && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Clínica nas Nuvens não está conectada em Integrações.
          </p>
        )}
        {result.status === "error" && <p className="text-sm text-red-500">{result.errorMessage}</p>}
        {result.status === "ok" && (
          <>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {result.rows.length} agendamentos
              {notFound > 0 ? ` — ${notFound} não encontrado${notFound === 1 ? "" : "s"} no Clínica nas Nuvens` : ""}
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    {["Código", "Data", "Paciente", "Telefone", "E-mail"].map((header) => (
                      <th key={header} className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.codigo} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{row.codigo}</td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {row.data?.split("-").reverse().join("/")}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{row.paciente ?? ""}</td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {row.found ? (row.telefone ?? "—") : <span className="text-red-500">não encontrado</span>}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{row.email ?? ""}</td>
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
