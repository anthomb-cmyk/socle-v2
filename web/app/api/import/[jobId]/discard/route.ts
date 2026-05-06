// POST /api/import/[jobId]/discard
//
// Marks a preview-stage import_job as cancelled so it stops showing up in the
// "pending preview" detector on the import page. Used when the user explicitly
// says "no, don't resume that — start fresh".

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function POST(_request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { jobId } = await ctx.params;

  const admin = createSupabaseAdminClient();

  // Only allow discarding your own preview-stage jobs.
  const { data: job, error: fetchErr } = await admin
    .from("import_jobs")
    .select("id, status, uploaded_by")
    .eq("id", jobId)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ ok: false, error: "Import not found" }, { status: 404 });
  }
  if (job.uploaded_by !== user.id) {
    return NextResponse.json({ ok: false, error: "Not your import" }, { status: 403 });
  }
  if (job.status !== "preview") {
    return NextResponse.json({ ok: false, error: `Cannot discard job in status '${job.status}'` }, { status: 409 });
  }

  const { error: updErr } = await admin
    .from("import_jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId);

  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
