// POST /api/import/[jobId]/confirm — commit a previewed import.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { commitImport } from "@/lib/import-commit";
import { runEnrichmentPipeline } from "@/lib/enrichment/pipeline";
import type { ParseResult } from "@/lib/role-parser/types";
import type { LeadContext } from "@/lib/enrichment/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const AUTO_ENRICH_MAX_LEADS = 50;

export async function POST(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // Parse optional body fields
  let autoEnrich = false;
  try {
    const body = await request.json().catch(() => ({}));
    autoEnrich = body?.autoEnrich === true;
  } catch {
    // If body parse fails, default to no auto-enrich
  }

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

  // Improvement 7: Auto-enrich — fire-and-forget, capped at AUTO_ENRICH_MAX_LEADS
  if (autoEnrich && counts.leads_created > 0) {
    // Fetch newly created leads for this import job (up to the cap)
    const { data: newLeads } = await admin
      .from("leads")
      .select("id, contact_id, contacts(full_name, company_name, mailing_address, mailing_city, mailing_postal), properties(address, city, matricule, num_units)")
      .eq("source_import_job_id", jobId)
      .eq("status", "new")
      .limit(AUTO_ENRICH_MAX_LEADS);

    if (newLeads && newLeads.length > 0) {
      // Fire-and-forget: don't await, run enrichment in background
      (async () => {
        for (const lead of newLeads) {
          try {
            const contact = (lead as Record<string, unknown>).contacts as Record<string, unknown> | null;
            const property = (lead as Record<string, unknown>).properties as Record<string, unknown> | null;
            const rawFullName = (contact?.full_name as string | null) ?? null;
            let primaryName: string | null = null;
            let secondaryName: string | null = null;
            if (rawFullName) {
              const sep = rawFullName.match(/\s*[\/|]\s*|\s+et\s+|\s+and\s+/i);
              if (sep?.index !== undefined) {
                primaryName = rawFullName.slice(0, sep.index).trim() || null;
                secondaryName = rawFullName.slice(sep.index + sep[0].length).trim() || null;
              } else {
                primaryName = rawFullName;
              }
            }

            const { data: jobRow } = await admin.from("enrichment_jobs").insert({
              lead_id:     lead.id,
              contact_id:  lead.contact_id,
              workflow_id: "pipeline_v2_address_first",
              job_type:    "find_phone",
              status:      "processing",
              started_at:  new Date().toISOString(),
              raw_input:   { leadId: lead.id, pipeline: "address_first_v2", auto_enrich_import: true },
            }).select("id").single();

            if (!jobRow) continue;
            const enrichmentJobId = (jobRow as { id: string }).id;

            const enrichCtx: LeadContext = {
              leadId:          lead.id,
              contactId:       lead.contact_id,
              enrichmentJobId,
              fullName:        primaryName,
              companyName:     (contact?.company_name as string | null) ?? null,
              secondaryName,
              propertyAddress: (property?.address as string | null) ?? null,
              propertyCity:    (property?.city as string | null) ?? null,
              mailingAddress:  (contact?.mailing_address as string | null) ?? null,
              mailingCity:     (contact?.mailing_city as string | null) ?? null,
              mailingPostal:   (contact?.mailing_postal as string | null) ?? null,
              matricule:       (property?.matricule as string | null) ?? null,
              numUnits:        (property?.num_units as number | null) ?? null,
            };

            const result = await runEnrichmentPipeline(admin, enrichCtx);
            const jobStatus = result.outcome === "openclaw_dispatched" ? "processing"
              : result.outcome === "unresolved" ? "failed" : "completed";
            await admin.from("enrichment_jobs").update({
              status:       jobStatus,
              completed_at: result.openclawDispatched ? undefined : new Date().toISOString(),
              raw_output:   { outcome: result.outcome, stageReached: result.stageReached },
            }).eq("id", enrichmentJobId);
          } catch {
            // Non-critical — log failure but keep enriching the rest
          }
        }
      })();
    }
  }

  return NextResponse.json({ ok: true, data: counts });
}
