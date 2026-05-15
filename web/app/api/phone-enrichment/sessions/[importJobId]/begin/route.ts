// POST /api/phone-enrichment/sessions/[importJobId]/begin
// Issues a short-lived Codex session token scoped to one import.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  createCodexSessionToken,
  hashCodexSessionToken,
  requirePhoneEnrichmentOperator,
} from "@/lib/phone-enrichment/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  expiresInMinutes: z.number().int().min(15).max(240).optional(),
}).strict();

type RouteCtx = { params: Promise<{ importJobId: string }> };

export async function POST(request: Request, ctx: RouteCtx) {
  const { importJobId } = await ctx.params;
  const auth = await requirePhoneEnrichmentOperator(request, importJobId);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { data: importJob, error: importErr } = await sb
    .from("import_jobs")
    .select("id")
    .eq("id", importJobId)
    .maybeSingle();

  if (importErr) return NextResponse.json({ ok: false, error: importErr.message }, { status: 500 });
  if (!importJob) return NextResponse.json({ ok: false, error: "Import not found." }, { status: 404 });

  const token = createCodexSessionToken();
  const expiresAt = new Date(Date.now() + (body.expiresInMinutes ?? 60) * 60_000).toISOString();

  const { data: session, error } = await sb
    .from("codex_sessions")
    .insert({
      import_job_id: importJobId,
      started_by: auth.userId,
      actor_kind: "codex",
      token_hash: hashCodexSessionToken(token),
      expires_at: expiresAt,
      last_action_at: new Date().toISOString(),
    })
    .select("id,import_job_id,started_at,expires_at,status")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await sb.from("automation_events").insert({
    source: "web_app",
    actor_kind: "codex",
    event_type: "codex_session_started",
    status: "success",
    related_import_id: importJobId,
    triggered_by: auth.userId,
    payload: {
      codex: {
        action_type: "begin_session",
        session_id: (session as { id: string }).id,
        expires_at: expiresAt,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      session,
      sessionToken: token,
      expiresAt,
    },
  });
}
