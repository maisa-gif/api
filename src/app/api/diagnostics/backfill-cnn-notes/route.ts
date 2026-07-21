import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ClinicaNasNuvensClient } from "@/lib/integrations/clinica-nas-nuvens/client";
import { GoogleDriveClient } from "@/lib/integrations/google-drive/client";
import { getIntegrationStatus } from "@/lib/integrations/service";
import { findPatientPhone, parseGeminiFileName } from "@/lib/sync/drive-transcripts-bitrix";

/**
 * TEMPORARY one-off backfill route — delete after running once.
 *
 * appendAppointmentNote() (linking the transcript on the CNN
 * appointment's observações) was added after 4 transcripts were already
 * synced to Bitrix. This re-derives each already-synced row's CNN
 * appointment and adds the note, WITHOUT re-attaching to Bitrix (that's
 * not idempotent — re-running it would duplicate the timeline
 * attachment).
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cnnStatus = await getIntegrationStatus("CLINICA_NAS_NUVENS");
  if (!cnnStatus.enabled || !cnnStatus.token) {
    return NextResponse.json(
      { error: "Clínica nas Nuvens integration is disabled or missing its token/hash." },
      { status: 400 }
    );
  }

  const cnnClient = new ClinicaNasNuvensClient(cnnStatus.token);
  const driveClient = new GoogleDriveClient();

  const rows = await prisma.syncedTranscript.findMany({
    where: { status: "synced", NOT: { errorMessage: { contains: "CNN observações updated" } } },
  });

  const results: Array<{ file: string; outcome: string }> = [];

  for (const row of rows) {
    try {
      const { eventName, date } = parseGeminiFileName(row.driveFileName);
      if (!date) {
        results.push({ file: row.driveFileName, outcome: "No date parsed" });
        continue;
      }

      const { appointmentId } = await findPatientPhone(cnnClient, eventName, date);
      if (!appointmentId) {
        results.push({ file: row.driveFileName, outcome: "No CNN appointment found" });
        continue;
      }

      const file = await driveClient.getFile(row.driveFileId);
      const link = file.webViewLink ?? `Drive file: ${file.name}`;
      await cnnClient.appendAppointmentNote(appointmentId, `Transcrição da consulta (Gemini): ${link}`);

      await prisma.syncedTranscript.update({
        where: { id: row.id },
        data: { errorMessage: "CNN observações updated (backfilled)" },
      });
      results.push({ file: row.driveFileName, outcome: `Updated appointment ${appointmentId}` });
    } catch (err) {
      results.push({
        file: row.driveFileName,
        outcome: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return NextResponse.json({ results });
}
