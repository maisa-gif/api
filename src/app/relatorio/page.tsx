import Link from "next/link";
import { getDailySalesSummary } from "@/lib/report/daily-sales";
import { getDailyFinanceSummary } from "@/lib/report/daily-finance";

// Must reflect "today" on every visit, not a value baked in at build time.
export const dynamic = "force-dynamic";

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function SetupNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      {children}
    </p>
  );
}

export default async function RelatorioPage() {
  const [sales, finance] = await Promise.all([getDailySalesSummary(), getDailyFinanceSummary()]);

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Relatório do dia</h1>

      <Card title="Vendas de hoje">
        {sales.status === "not_configured" && (
          <SetupNotice>Configure SALES_SHEET_ID no ambiente para ligar a planilha de vendas.</SetupNotice>
        )}
        {sales.status === "not_connected" && (
          <SetupNotice>
            Conecte o Google em <Link href="/settings/integrations" className="underline">Integrações</Link> para
            ler a planilha de vendas.
          </SetupNotice>
        )}
        {sales.status === "error" && (
          <p className="text-sm text-red-500">{sales.errorMessage}</p>
        )}
        {sales.status === "ok" && (
          <>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {sales.rows.length} venda{sales.rows.length === 1 ? "" : "s"} hoje
              {sales.totalValue > 0 ? ` — ${formatCurrency(sales.totalValue)}` : ""}
            </p>
            {sales.byProduct.length > 0 && (
              <ul className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {sales.byProduct.map((p) => (
                  <li key={p.product}>
                    {p.product}: {p.count} venda{p.count === 1 ? "" : "s"} — {formatCurrency(p.totalValue)}
                  </li>
                ))}
              </ul>
            )}
            {sales.rows.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                      {Object.keys(sales.rows[0]).map((header) => (
                        <th key={header} className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sales.rows.map((row, i) => (
                      <tr key={i} className="border-b border-zinc-100 dark:border-zinc-900">
                        {Object.values(row).map((value, j) => (
                          <td key={j} className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Financeiro do dia (Conta Azul)">
        {finance.status === "not_connected" && (
          <SetupNotice>
            Conecte a Conta Azul em <Link href="/settings/integrations" className="underline">Integrações</Link> para
            ver o que foi pago e recebido hoje.
          </SetupNotice>
        )}
        {finance.status === "error" && (
          <p className="text-sm text-red-500">{finance.errorMessage}</p>
        )}
        {finance.status === "ok" && (
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Recebido hoje</p>
              <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(finance.totalReceived)}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Pago hoje</p>
              <p className="mt-1 text-xl font-semibold text-red-500 dark:text-red-400">
                {formatCurrency(finance.totalPaid)}
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
