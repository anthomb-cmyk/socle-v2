// POST /api/n8n/event — single audit-log sink for n8n workflows.
//
// Auth: shared bearer key. If N8N_SHARED_KEY is unset, allow in development
// but include a warning in the response. NEVER unguarded in prod.
//
// Body: {
//   event_type: string                 // e.g. "email_classified", "lead_created"
//   status?: "started" | "success" | "failed" | "partial"
//   related_lead_id?: uuid
//   related_contact_id?: uuid
//   related_property_id?: uuid
//   related_import_id?: uuid
//   payload?: any
//   result?: any
//   error_message?: string
//   n8n_execution_id?: string
// }

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  event_type: z.string().min(1).max(100),
  status: z.enum(["started", "success", "failed", "partial"]).optional(),
  related_lead_id: z.string().uuid().nullable().optional(),
  related_contact_id: z.string().uuid().nullable().optional(),
  related_property_id: z.string().uuid().nullable().optional(),
  related_import_id: z.string().uuid().nullable().optional(),
  payload: z.unknown().optional(),
  result: z.unknown().optional(),
  error_message: z.string().nullable().optional(),
  n8n_execution_id: z.string().optional(),
});

export async function POST(request: Request) {
  // Auth: shared bearer
  const expected = process.env.N8N_SHARED_KEY;
  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.replace(/^Bearer\s+/i, "");
  let warning: string | undefined;
  if (expected) {
    if (provided !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "N8N_SHARED_KEY not configured" }, { status: 500 });
  } else {
    warning = "N8N_SHARED_KEY not set — allowed in dev. Set it before deploying.";
  }

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb.from("automation_events").insert({
    source: "n8n",
    event_type: body.event_type,
    status: body.status ?? "success",
    related_lead_id: body.related_lead_id ?? null,
    related_contact_id: body.related_contact_id ?? null,
    related_property_id: body.related_property_id ?? null,
    related_import_id: body.related_import_id ?? null,
    payload: body.payload ?? null,
    result: body.result ?? null,
    error_message: body.error_message ?? null,
    n8n_execution_id: body.n8n_execution_id ?? null,
  }).select("id").single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: { eventId: (data as { id: string }).id }, warning });
}
