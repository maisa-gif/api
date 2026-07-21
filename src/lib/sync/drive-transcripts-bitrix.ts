import { GoogleDriveApiError, GoogleDriveClient, type DriveFile } from "@/lib/integrations/google-drive/client";
import { BitrixApiError, BitrixClient, type BitrixContact } from "@/lib/integrations/bitrix/client";
import { hasBitrixConfig } from "@/lib/integrations/bitrix/config";
import { getGoogleCalendarConnection } from "@/lib/integrations/google-calendar/connection";
import {
  ClinicaNasNuvensApiError,
  ClinicaNasNuvensClient,
} from "@/lib/integrations/clinica-nas-nuvens/client";
import { getIntegrationStatus } from "@/lib/integrations/service";
import { prisma } from "@/lib/prisma";

export interface DriveTranscriptSyncResult {
  synced: number;
  noMatch: number;
  ambiguous: number;
  skipped: number;
  errors: string[];
}

function describeError(err: unknown): string {
  if (
    err instanceof GoogleDriveApiError ||
    err instanceof BitrixApiError ||
    err instanceof ClinicaNasNuvensApiError
  ) {
    return `${err.message} (status ${err.status}, body: ${JSON.stringify(err.body)})`;
  }
  return err instanceof Error ? err.message : String(err);
}

// Same professional filter as the agenda sync (src/lib/sync/clinica-nas-nuvens-google-calendar.ts) —
// transcripts are only relevant for that professional's consultations.
const EXECUTOR_ID = process.env.CLINICA_NAS_NUVENS_EXECUTOR_ID
  ? Number(process.env.CLINICA_NAS_NUVENS_EXECUTOR_ID)
  : undefined;

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Parses a Gemini notes file name into the meeting/event name (== patient
 * name, since our synced Calendar events are titled with the patient's
 * name) and the appointment date. Confirmed against real Drive file
 * names, e.g. "Victor Cirne Carvalho – 2026/07/21 15:51 GMT-03:00 –
 * Anotações do Gemini" — finds the "YYYY/MM/DD HH:MM GMT±HH:MM" token,
 * takes everything before it as the name (so a dash inside the title
 * itself doesn't get mistaken for the separator), and the date part for
 * looking up the matching CNN appointment.
 */
export function parseGeminiFileName(fileName: string): { eventName: string; date: string | null } {
  const withoutExt = fileName.replace(/\.[a-z0-9]+$/i, "");
  const dateMatch = withoutExt.match(/(\d{4})\/(\d{2})\/(\d{2})\s+\d{2}:\d{2}\s+GMT[+-]\d{2}:\d{2}/);
  const namePart = dateMatch ? withoutExt.slice(0, dateMatch.index) : withoutExt;
  const eventName = namePart.replace(/[\s–—-]+$/g, "").trim();
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  return { eventName, date };
}

/**
 * Finds the CNN appointment matching `patientName` on `date` and returns
 * its phone number — CNN's per-appointment `telefoneCelularPaciente` is a
 * more reliable Bitrix match key than the name alone (no accent/spelling
 * ambiguity). Returns null if no CNN appointment matches, so the caller
 * can fall back to name-based matching.
 */
async function findPatientPhone(
  cnnClient: ClinicaNasNuvensClient,
  patientName: string,
  date: string
): Promise<string | null> {
  const appointments = await cnnClient.listAppointments(date, date, EXECUTOR_ID);
  const target = normalizeName(patientName);

  for (const appointment of appointments) {
    const summary = await cnnClient.getAppointmentSummary(appointment.id);
    if (normalizeName(summary.nomePaciente) === target) {
      return appointment.telefoneCelularPaciente;
    }
  }

  return null;
}

async function findMatchingContacts(
  bitrixClient: BitrixClient,
  cnnClient: ClinicaNasNuvensClient | null,
  eventName: string,
  date: string | null
): Promise<{ contacts: BitrixContact[]; matchedBy: "phone" | "name" }> {
  if (cnnClient && date) {
    try {
      const phone = await findPatientPhone(cnnClient, eventName, date);
      if (phone) {
        const byPhone = await bitrixClient.findContactsByPhone(phone);
        if (byPhone.length > 0) {
          return { contacts: byPhone, matchedBy: "phone" };
        }
      }
    } catch {
      // CNN lookup failing (e.g. no appointment that day) isn't fatal —
      // fall through to name matching below.
    }
  }

  return { contacts: await bitrixClient.findContactsByName(eventName), matchedBy: "name" };
}

/**
 * Finds new Google Meet "Gemini notes" files in Drive, matches each to a
 * Bitrix24 contact (by the CNN patient's phone number when available,
 * falling back to the name embedded in the file name), and attaches the
 * file to that contact's CRM timeline.
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

  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  const cnnClient =
    cnnStatus.enabled && cnnStatus.token ? new ClinicaNasNuvensClient(cnnStatus.token) : null;

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
      // Only "error" rows are retried — a transient/fixable failure (like
      // the Bitrix webhook missing a permission) shouldn't be skipped
      // forever just because a row already exists for it. no_match/
      // ambiguous outcomes are left alone: those need a human decision,
      // not an automatic retry.
      if (existing && existing.status !== "error") {
        result.skipped += 1;
        continue;
      }

      const { eventName, date } = parseGeminiFileName(file.name);
      const { contacts, matchedBy } = eventName
        ? await findMatchingContacts(bitrixClient, cnnClient, eventName, date)
        : { contacts: [] as BitrixContact[], matchedBy: "name" as const };

      if (contacts.length === 0) {
        result.noMatch += 1;
        await prisma.syncedTranscript.upsert({
          where: { driveFileId: file.id },
          create: { driveFileId: file.id, driveFileName: file.name, matchedName: eventName, status: "no_match" },
          update: { matchedName: eventName, status: "no_match", errorMessage: null, syncedAt: new Date() },
        });
        continue;
      }

      if (contacts.length > 1) {
        result.ambiguous += 1;
        await prisma.syncedTranscript.upsert({
          where: { driveFileId: file.id },
          create: { driveFileId: file.id, driveFileName: file.name, matchedName: eventName, status: "ambiguous" },
          update: { matchedName: eventName, status: "ambiguous", errorMessage: null, syncedAt: new Date() },
        });
        continue;
      }

      const contact = contacts[0];
      const { bytes, contentType } = await driveClient.downloadFile(file);
      const needsPdfExt = contentType === "application/pdf" && !file.name.toLowerCase().endsWith(".pdf");
      const attachmentName = needsPdfExt ? `${file.name}.pdf` : file.name;

      await bitrixClient.attachFileToContactTimeline(
        contact.ID,
        `Gravação/transcrição da consulta (${file.name})${matchedBy === "phone" ? " — casado por telefone" : ""}`,
        { name: attachmentName, bytes }
      );

      await prisma.syncedTranscript.upsert({
        where: { driveFileId: file.id },
        create: {
          driveFileId: file.id,
          driveFileName: file.name,
          matchedName: eventName,
          bitrixContactId: contact.ID,
          status: "synced",
        },
        update: {
          matchedName: eventName,
          bitrixContactId: contact.ID,
          status: "synced",
          errorMessage: null,
          syncedAt: new Date(),
        },
      });
      result.synced += 1;
    } catch (err) {
      const message = describeError(err);
      result.errors.push(`File ${file.name}: ${message}`);
      await prisma.syncedTranscript.upsert({
        where: { driveFileId: file.id },
        create: { driveFileId: file.id, driveFileName: file.name, status: "error", errorMessage: message },
        update: { status: "error", errorMessage: message, syncedAt: new Date() },
      });
    }
  }

  return result;
}
