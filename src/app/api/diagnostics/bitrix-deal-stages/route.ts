import { NextResponse } from "next/server";
import { BitrixClient } from "@/lib/integrations/bitrix/client";

/**
 * TEMPORARY diagnostic route — delete once the "Avaliação Realizada" deal
 * stage's STATUS_ID has been identified for the deal-stage-move automation.
 * Lists every pipeline (funil) and its stages.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bitrixClient = new BitrixClient();
  const categories = await bitrixClient.listDealCategories();

  const pipelines = [];
  for (const category of categories) {
    const stages = await bitrixClient.listDealStages(category.ID);
    pipelines.push({ id: category.ID, name: category.NAME, stages });
  }

  // Default pipeline (category "0") isn't always returned by
  // crm.dealcategory.list, so fetch it explicitly too.
  const defaultStages = await bitrixClient.listDealStages("0");
  pipelines.unshift({ id: "0", name: "(Funil padrão)", stages: defaultStages });

  return NextResponse.json({ pipelines });
}
