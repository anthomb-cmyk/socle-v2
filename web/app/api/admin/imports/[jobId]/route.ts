// GET /api/admin/imports/[jobId] — return single import_job row
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
    .from("import_jobs")
    .select("id, file_name, status, format_detected, total_rows, properties_created, contacts_created, leads_created, phones_created, errors_count, created_at")
    .eq("id", jobId)
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data });
}
