// POST /api/admin/imports/[jobId]/revert
//
// Revert semantics:
//   - For each lead created by this import (where source_import_job_id = jobId),
//     set lead.status = 'unsuitable_for_phone_enrichment'.
//   - Insert one enrichment_events row documenting the revert (audit trail).
//   - Does NOT delete leads, contacts, or properties — data is preserved for audit.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(_request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { jobId } = await ctx.params;
  const admin = createSupabaseAdminClient();

  // Verify the import job exists
  const { data: job, error: jobErr } = await admin
    .from("import_jobs")
    .select("id, status, leads_created")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ ok: false, error: "Import job not found" }, { status: 404 });
  }

  // Fetch all leads created by this import
  const { data: leads, error: leadsErr } = await admin
    .from("leads")
    .select("id")
    .eq("source_import_job_id", jobId)
    .neq("status", "unsuitable_for_phone_enrichment");

  if (leadsErr) {
    return NextResponse.json({ ok: false, error: `Failed to fetch leads: ${leadsErr.message}` }, { status: 500 });
  }

  const leadIds = (leads ?? []).map((l: { id: string }) => l.id);

  if (leadIds.length === 0) {
    return NextResponse.json({ ok: true, data: { reverted: 0 } });
  }

  // Soft-delete: flip status to unsuitable
  const { error: updateErr } = await admin
    .from("leads")
    .update({ status: "unsuitable_for_phone_enrichment" })
    .in("id", leadIds);

  if (updateErr) {
    return NextResponse.json({ ok: false, error: `Failed to update leads: ${updateErr.message}` }, { status: 500 });
  }

  // Write audit events for each lead
  const events = leadIds.map((leadId: string) => ({
    lead_id: leadId,
    event_type: "import_reverted",
    stage: null,
    candidate_id: null,
    payload: {
      import_job_id: jobId,
      reverted_by: user.id,
      reverted_at: new Date().toISOString(),
      reason: "admin_revert",
    },
  }));

  await admin.from("enrichment_events").insert(events);

  // Record on the import_job itself for quick visibility
  await admin.from("import_jobs").update({ status: "reverted" }).eq("id", jobId);

  return NextResponse.json({ ok: true, data: { reverted: leadIds.length } });
}
