import { getValidGoogleAccessToken } from "../google-calendar/connection";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export class GmailApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
  }
}

/** RFC 2047 "encoded word" so accented subject text survives mail clients. */
function encodeSubject(subject: string): string {
  return `=?utf-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

/** Sends an HTML email from the connected Google account via the Gmail API. */
export async function sendGmail(options: { to: string; subject: string; html: string }): Promise<void> {
  const accessToken = await getValidGoogleAccessToken();

  const message = [
    `To: ${options.to}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    `Subject: ${encodeSubject(options.subject)}`,
    "",
    options.html,
  ].join("\r\n");

  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: Buffer.from(message).toString("base64url") }),
  });

  if (!response.ok) {
    throw new GmailApiError("Failed to send report email", response.status, await safeReadBody(response));
  }
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
