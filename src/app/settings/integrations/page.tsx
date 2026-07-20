import { listIntegrationStatuses } from "@/lib/integrations/service";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";

export default async function IntegrationsSettingsPage() {
  const integrations = await listIntegrationStatuses();

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Integrações</h1>
      {integrations.map((integration) => (
        <IntegrationCard key={integration.type} initial={integration} />
      ))}
    </div>
  );
}
