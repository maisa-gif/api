import { NextResponse } from "next/server";
import {
  getIntegrationStatus,
  setIntegrationEnabled,
  setIntegrationToken,
} from "@/lib/integrations/service";
import { isIntegrationType } from "@/lib/integrations/types";

interface RouteParams {
  params: Promise<{ type: string }>;
}

// TODO: gate behind an admin-only auth check before shipping — these routes
// return/accept internal credentials and tokens.
export async function GET(_request: Request, { params }: RouteParams) {
  const { type } = await params;
  if (!isIntegrationType(type)) {
    return NextResponse.json({ error: "Unknown integration type" }, { status: 404 });
  }

  return NextResponse.json(await getIntegrationStatus(type));
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { type } = await params;
  if (!isIntegrationType(type)) {
    return NextResponse.json({ error: "Unknown integration type" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { enabled?: boolean; token?: string }
    | null;

  if (!body || (body.enabled === undefined && body.token === undefined)) {
    return NextResponse.json(
      { error: "Provide 'enabled' and/or 'token' in the request body" },
      { status: 400 }
    );
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "'enabled' must be a boolean" }, { status: 400 });
    }
    await setIntegrationEnabled(type, body.enabled);
  }

  if (body.token !== undefined) {
    if (typeof body.token !== "string" || body.token.trim() === "") {
      return NextResponse.json({ error: "'token' must be a non-empty string" }, { status: 400 });
    }
    await setIntegrationToken(type, body.token.trim());
  }

  return NextResponse.json(await getIntegrationStatus(type));
}
