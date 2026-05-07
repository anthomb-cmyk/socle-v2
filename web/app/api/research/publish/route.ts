// POST /api/research/publish
// Admin-only endpoint that publishes a completed owner_record to the CRM.
//
// Body: { ownerId: string }
// Returns: PublishResult JSON on success, { error: string } with status 500 on failure.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { publishOwnerRecordToCrm } from "@/lib/research/crm-bridge";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { ownerId } = (body ?? {}) as { ownerId?: string };
  if (!ownerId || typeof ownerId !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing required field: ownerId" },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  try {
    const result = await publishOwnerRecordToCrm(sb, { ownerId });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[research/publish] unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
