// Central list of supported external API integrations. Add a new key here
// (and a matching entry in `registry.ts`) to onboard another integration.
export const INTEGRATION_TYPES = ["CLINICA_NAS_NUVENS"] as const;

export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export function isIntegrationType(value: string): value is IntegrationType {
  return (INTEGRATION_TYPES as readonly string[]).includes(value);
}
