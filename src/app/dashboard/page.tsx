import Link from "next/link";
import { getAgendaSummary, getPipelineSummary } from "@/lib/dashboard/data";

// Always fetches live agenda/pipeline data at request time — nothing here
// should be prerendered at build time (and doing so would require a
// reachable Postgres/CNN/Bitrix connection during `next build`).
export const dynamic = "force-dynamic";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
      {children}
    </div>
  );
}

function EmptyState({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-400">
      {text}{" "}
      <Link href={href} className="text-emerald-600 underline dark:text-emerald-400">
        {cta}
      </Link>
      .
    </p>
  );
}

export default async function DashboardPage() {
  const [agenda, pipeline] = await Promise.all([getAgendaSummary(), getPipelineSummary()]);

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
        <Link
          href="/settings/integrations"
          className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          Integrações
        </Link>
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Agenda de hoje</h2>

        {!agenda.configured && (
          <div className="mt-4">
            <EmptyState
              text="A integração com a Clínica nas Nuvens não está ativada"
              href="/settings/integrations"
              cta="ative-a nas configurações"
            />
          </div>
        )}

        {agenda.configured && agenda.error && (
          <p className="mt-4 text-sm text-red-500">Erro ao buscar a agenda: {agenda.error}</p>
        )}

        {agenda.configured && !agenda.error && (
          <>
            {agenda.today.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                Nenhuma consulta agendada para hoje.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
                {agenda.today.map((appointment) => (
                  <li key={appointment.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {appointment.patientName}
                      </p>
                      <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {appointment.procedimentos || appointment.status}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {appointment.horaInicio}–{appointment.horaFim}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
              {agenda.upcomingCount} consulta{agenda.upcomingCount === 1 ? "" : "s"} nos próximos{" "}
              {agenda.upcomingWindowDays} dias.
            </p>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Funil comercial</h2>

        {!pipeline.configured && (
          <div className="mt-4">
            <EmptyState
              text="A integração com o Bitrix24 não está configurada"
              href="/settings/integrations"
              cta="veja como configurar"
            />
          </div>
        )}

        {pipeline.configured && pipeline.error && (
          <p className="mt-4 text-sm text-red-500">Erro ao buscar o funil: {pipeline.error}</p>
        )}

        {pipeline.configured && !pipeline.error && (
          <>
            {pipeline.totalDeals === 0 ? (
              <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                Nenhum negócio em aberto no funil.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {pipeline.stages.map((stage) => (
                  <li key={stage.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{stage.name}</span>
                      <span className="text-zinc-500 dark:text-zinc-400">{stage.count}</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${stage.percent}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
              {pipeline.totalDeals} negócio{pipeline.totalDeals === 1 ? "" : "s"} em aberto no total.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
