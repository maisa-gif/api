import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.syncedTranscript.findMany({
    where: {
      driveFileName: {
        contains: "Luiz Fernando braga",
      },
    },
  });
  const rows2 = await prisma.syncedTranscript.findMany({
    where: { driveFileName: { contains: "ITAMAR ALVES" } },
  });
  const rows3 = await prisma.syncedTranscript.findMany({
    where: { driveFileName: { contains: "João Victor Torres" } },
  });

  return NextResponse.json({ luiz: rows, itamar: rows2, joaoVictor: rows3 });
}
