// GET /api/import/[jobId] — fetch job status + preview

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(_request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { jobId } = await ctx.params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("import_jobs")
    .select("id, status, file_name, format_detected, total_rows, properties_created, properties_updated, contacts_created, contacts_updated, phones_created, leads_created, leads_updated, errors_count, completed_at, created_at, updated_at, preview_data")
    .eq("id", jobId).single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  return NextResponse.json({ ok: true, data });
}
