// GET /api/admin/imports/[jobId]/rows — return import_row_audits for a job
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(_request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { jobId } = await ctx.params;
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("import_row_audits")
    .select("id, row_number, outcome, blocking, warnings, owners")
    .eq("import_job_id", jobId)
    .order("row_number", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}
