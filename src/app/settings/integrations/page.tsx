import { listIntegrationStatuses } from "@/lib/integrations/service";
import { getGoogleCalendarConnection } from "@/lib/integrations/google-calendar/connection";
import { hasGoogleCalendarEnvConfig } from "@/lib/integrations/google-calendar/config";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";
import { GoogleCalendarCard } from "@/components/integrations/GoogleCalendarCard";

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google_calendar?: string }>;
}) {
  const [integrations, googleConnection, { google_calendar: googleCalendarStatus }] = await Promise.all([
    listIntegrationStatuses(),
    getGoogleCalendarConnection(),
    searchParams,
  ]);

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Integrações</h1>
      {integrations.map((integration) => (
        <IntegrationCard key={integration.type} initial={integration} />
      ))}
      <GoogleCalendarCard
        initial={{ ...googleConnection, hasEnvCredentials: hasGoogleCalendarEnvConfig() }}
        bannerStatus={googleCalendarStatus === "connected" || googleCalendarStatus === "error" ? googleCalendarStatus : undefined}
      />
    </div>
  );
}
