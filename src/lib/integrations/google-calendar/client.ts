import { getValidGoogleAccessToken } from "./connection";

const API_BASE = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export interface GoogleCalendarEvent extends GoogleCalendarEventInput {
  id: string;
  status: string;
}

export class GoogleCalendarApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
  }
}

export class GoogleCalendarClient {
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await getValidGoogleAccessToken();

    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new GoogleCalendarApiError(
        `Google Calendar request to ${path} failed`,
        response.status,
        await safeReadBody(response)
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async insertEvent(calendarId: string, event: GoogleCalendarEventInput): Promise<GoogleCalendarEvent> {
    return this.request<GoogleCalendarEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(event),
    });
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    event: GoogleCalendarEventInput
  ): Promise<GoogleCalendarEvent> {
    return this.request<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "PUT", body: JSON.stringify(event) }
    );
  }

  /** Idempotent: a 404/410 (already gone) is treated as success. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.request<void>(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" }
      );
    } catch (err) {
      if (err instanceof GoogleCalendarApiError && (err.status === 404 || err.status === 410)) {
        return;
      }
      throw err;
    }
  }
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
