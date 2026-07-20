// Types handled by the generic settings card (enable toggle + env
// client_id/client_secret + editable token) and its GET/PATCH
// /api/integrations/[type] routes. Add a new key here (and a matching entry
// in `registry.ts`) to onboard another integration of that shape.
//
// OAuth-based integrations like GOOGLE_CALENDAR don't fit this shape (no
// static token to PATCH, credentials come from a consent redirect instead)
// and are handled by their own dedicated routes under
// src/app/api/integrations/google-calendar/ — they still use the shared
// `Integration` DB table, just with a `type` value outside this union.
export const INTEGRATION_TYPES = ["CLINICA_NAS_NUVENS"] as const;

export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export function isIntegrationType(value: string): value is IntegrationType {
  return (INTEGRATION_TYPES as readonly string[]).includes(value);
}
