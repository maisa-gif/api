export interface GoogleCalendarEnvConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleCalendarConfigError extends Error {}

/**
 * Google OAuth app credentials, created once in the Google Cloud Console
 * (APIs & Services > Credentials > OAuth client ID, type "Web application"),
 * with the Calendar API enabled and this app's callback URL registered as
 * an authorized redirect URI. Read from the environment only — never
 * stored in the DB or editable through the UI.
 */
export function getGoogleCalendarEnvConfig(): GoogleCalendarEnvConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    throw new GoogleCalendarConfigError(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL must be set to use the Google Calendar integration."
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, "")}/api/integrations/google-calendar/callback`,
  };
}

export function hasGoogleCalendarEnvConfig(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL
  );
}
