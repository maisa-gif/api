import { GoogleDriveApiError, GoogleDriveClient, type DriveFile } from "@/lib/integrations/google-drive/client";
import { BitrixApiError, BitrixClient } from "@/lib/integrations/bitrix/client";
import { hasBitrixConfig } from "@/lib/integrations/bitrix/config";
import { getGoogleCalendarConnection } from "@/lib/integrations/google-calendar/connection";
import { prisma } from "@/lib/prisma";

export interface DriveTranscriptSyncResult {
  synced: number;
  noMatch: number;
  ambiguous: number;
  skipped: number;
  errors: string[];
}

function describeError(err: unknown): string {
  if (err instanceof GoogleDriveApiError || err instanceof BitrixApiError) {
    return `${err.message} (status ${err.status}, body: ${JSON.stringify(err.body)})`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Extracts the meeting/event name (== patient name, since our synced
 * Calendar events are titled with the patient's name) from a Gemini
 * notes file name. Unverified against a real Drive file name — only
 * seen a sanitized downloaded copy
 * ("Maisa__20260717_19_48_UTC__Anotac_o_es_do_Gemini.pdf") — so this
 * looks for the first date/UTC-like token and takes everything before
 * it, falling back to splitting on "Anota"/"Gemini". Adjust once tested
 * against real files.
 */
export function extractEventNameFromFileName(fileName: string): string {
  const withoutExt = fileName.replace(/\.[a-z0-9]+$/i, "");
  const dateTokenMatch = withoutExt.match(
    /^(.*?)[\s_-]{1,3}\d{6,8}[_-]?\d{0,2}[_-]?\d{0,2}[_-]?(?:UTC)?/i
  );
  const base = dateTokenMatch?.[1] ?? withoutExt.split(/anota[cç][aã]o|gemini/i)[0];
  return base.replace(/[\s_-]+$/g, "").replace(/_/g, " ").trim();
}

/**
 * Finds new Google Meet "Gemini notes" files in Drive, matches each to a
 * Bitrix24 contact by the patient name embedded in the file name, and
 * attaches the file to that contact's CRM timeline.
 */
export async function syncDriveTranscriptsToBitrix(): Promise<DriveTranscriptSyncResult> {
  const result: DriveTranscriptSyncResult = {
    synced: 0,
    noMatch: 0,
    ambiguous: 0,
    skipped: 0,
    errors: [],
  };

  if (!hasBitrixConfig()) {
    result.errors.push("BITRIX_WEBHOOK_URL is not configured.");
    return result;
  }

  const googleConnection = await getGoogleCalendarConnection();
  if (!googleConnection.connected || !googleConnection.enabled) {
    result.errors.push("Google is not connected (needed for Drive access too).");
    return result;
  }

  const driveClient = new GoogleDriveClient();
  const bitrixClient = new BitrixClient();

  let files: DriveFile[];
  try {
    files = await driveClient.listGeminiNotes();
  } catch (err) {
    result.errors.push(`Failed to list Drive files: ${describeError(err)}`);
    return result;
  }

  for (const file of files) {
    try {
      const existing = await prisma.syncedTranscript.findUnique({ where: { driveFileId: file.id } });
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const matchedName = extractEventNameFromFileName(file.name);
      const contacts = matchedName ? await bitrixClient.findContactsByName(matchedName) : [];

      if (contacts.length === 0) {
        result.noMatch += 1;
        await prisma.syncedTranscript.create({
          data: { driveFileId: file.id, driveFileName: file.name, matchedName, status: "no_match" },
        });
        continue;
      }

      if (contacts.length > 1) {
        result.ambiguous += 1;
        await prisma.syncedTranscript.create({
          data: { driveFileId: file.id, driveFileName: file.name, matchedName, status: "ambiguous" },
        });
        continue;
      }

      const contact = contacts[0];
      const { bytes, contentType } = await driveClient.downloadFile(file);
      const needsPdfExt = contentType === "application/pdf" && !file.name.toLowerCase().endsWith(".pdf");
      const attachmentName = needsPdfExt ? `${file.name}.pdf` : file.name;

      await bitrixClient.attachFileToContactTimeline(
        contact.ID,
        `Gravação/transcrição da consulta (${file.name})`,
        { name: attachmentName, bytes }
      );

      await prisma.syncedTranscript.create({
        data: {
          driveFileId: file.id,
          driveFileName: file.name,
          matchedName,
          bitrixContactId: contact.ID,
          status: "synced",
        },
      });
      result.synced += 1;
    } catch (err) {
      const message = describeError(err);
      result.errors.push(`File ${file.name}: ${message}`);
      await prisma.syncedTranscript.create({
        data: { driveFileId: file.id, driveFileName: file.name, status: "error", errorMessage: message },
      });
    }
  }

  return result;
}
