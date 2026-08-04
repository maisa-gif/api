import { randomUUID } from "node:crypto";
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
  hangoutLink?: string;
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

  /**
   * Creates the event with a Google Meet link attached (conferenceDataVersion=1
   * is required for the API to act on conferenceData at all). This is how the
   * doctor gets a ready-to-join link on the synced appointment without having
   * to add one by hand before starting the consultation.
   */
  async insertEvent(calendarId: string, event: GoogleCalendarEventInput): Promise<GoogleCalendarEvent> {
    return this.request<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`,
      {
        method: "POST",
        body: JSON.stringify({
          ...event,
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      }
    );
  }

  /**
   * PATCH (partial update), not PUT — a full replace would need conferenceData
   * re-sent every time or it gets dropped, wiping out the Meet link created at
   * insert time on every subsequent sync update.
   */
  async updateEvent(
    calendarId: string,
    eventId: string,
    event: GoogleCalendarEventInput
  ): Promise<GoogleCalendarEvent> {
    return this.request<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "PATCH", body: JSON.stringify(event) }
    );
  }

  async getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent> {
    return this.request<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );
  }

  /**
   * One-off backfill helper: adds a Meet link to an event that doesn't have
   * one yet (existing events created before insertEvent() started requesting
   * conferenceData). Same conferenceDataVersion=1 requirement as insertEvent.
   */
  async addMeetLink(calendarId: string, eventId: string): Promise<GoogleCalendarEvent> {
    return this.request<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
      {
        method: "PATCH",
        body: JSON.stringify({
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      }
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
