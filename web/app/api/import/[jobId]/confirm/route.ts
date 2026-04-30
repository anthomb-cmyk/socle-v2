// POST /api/import/[jobId]/confirm — commit a previewed import.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { commitImport } from "@/lib/import-commit";
import type { ParseResult } from "@/lib/role-parser/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { jobId } = await ctx.params;
  const admin = createSupabaseAdminClient();

  // Load the previewed job
  const { data: job, error: jobErr } = await admin.from("import_jobs").select("*").eq("id", jobId).single();
  if (jobErr || !job) return NextResponse.json({ ok: false, error: jobErr?.message ?? "Job not found" }, { status: 404 });
  if (job.status !== "preview") {
    return NextResponse.json({ ok: false, error: `Job is in status ${job.status}, expected 'preview'` }, { status: 409 });
  }

  // Move to processing
  await admin.from("import_jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", jobId);

  const parse: ParseResult | undefined = (job.preview_data as { parsed_full?: ParseResult })?.parsed_full;
  if (!parse) {
    await admin.from("import_jobs").update({ status: "failed" }).eq("id", jobId);
    return NextResponse.json({ ok: false, error: "Job has no parsed data" }, { status: 500 });
  }

  // Commit
  const counts = await commitImport(admin, parse, { importJobId: jobId, campaignId: job.campaign_id });

  // Update job + log automation event
  const finalStatus = counts.errors.length === 0 ? "completed" : "completed";  // we record errors but mark completed
  await admin.from("import_jobs").update({
    status: finalStatus,
    properties_created: counts.properties_created,
    properties_updated: counts.properties_updated,
    contacts_created: counts.contacts_created,
    contacts_updated: counts.contacts_updated,
    phones_created: counts.phones_created,
    leads_created: counts.leads_created,
    leads_updated: counts.leads_updated,
    duplicates_seen: counts.duplicates_seen,
    errors_count: counts.errors.length,
    errors: counts.errors,
    completed_at: new Date().toISOString(),
  }).eq("id", jobId);

  await admin.from("automation_events").insert({
    source: "web_app",
    event_type: "import_completed",
    status: counts.errors.length > 0 ? "partial" : "success",
    related_import_id: jobId,
    triggered_by: user.id,
    payload: {
      file_name: job.file_name,
      format: job.format_detected,
      campaign_id: job.campaign_id,
    },
    result: counts,
  });

  return NextResponse.json({ ok: true, data: counts });
}
