// GET /api/automation-events — admin audit log.
// Query: ?source=&status=&limit=&offset=

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const sb = createSupabaseAdminClient();
  let q = sb.from("automation_events")
    .select("id, source, event_type, status, related_lead_id, related_import_id, error_message, payload, result, telegram_message_id, occurred_at", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (source) q = q.eq("source", source);
  if (status) q = q.eq("status", status);
  const { data, error, count } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: { events: data ?? [], total: count ?? 0 } });
}
