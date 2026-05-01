// POST /api/enrichment/start
//
// Kicks off the multi-stage phone enrichment pipeline for a single lead.
// Runs stages 1-3 synchronously (Brave → 411 → Place API), dispatches stage 4
// (OpenClaw) asynchronously if needed.
//
// Body: { leadId: uuid }
//
// The route assembles LeadContext from the DB (joins leads → properties → contacts)
// and calls runEnrichmentPipeline().

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { runEnrichmentPipeline } from "@/lib/enrichment/pipeline";
import type { LeadContext } from "@/lib/enrichment/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  leadId: z.string().uuid(),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // Load full lead context in one query
  const { data: leadRaw } = await sb
    .from("leads")
    .select(`
      id, contact_id, status,
      properties ( address, city, matricule, num_units ),
      contacts (
        id, full_name, company_name,
        mailing_address, mailing_city, mailing_postal
      )
    `)
    .eq("id", body.leadId)
    .single();

  type LeadRow = {
    id: string;
    contact_id: string;
    status: string;
    properties: { address: string; city: string | null; matricule: string | null; num_units: number | null } | null;
    contacts: { id: string; full_name: string | null; company_name: string | null; mailing_address: string | null; mailing_city: string | null; mailing_postal: string | null } | null;
  };
  const lead = leadRaw as LeadRow | null;
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });

  // Skip if already has a verified phone
  const { data: phoneCheck } = await sb
    .from("phones")
    .select("id")
    .eq("contact_id", lead.contact_id)
    .eq("status", "verified")
    .limit(1);
  if ((phoneCheck ?? []).length > 0) {
    return NextResponse.json({
      ok: false,
      error: "Lead already has a verified phone — enrichment not needed",
      skipped: true,
    });
  }

  // Skip if already actively running
  const activeStatuses = ["enrichment_running", "needs_human_review", "openclaw_queued"];
  if (activeStatuses.includes(lead.status)) {
    return NextResponse.json({
      ok: false,
      error: `Lead is already in status '${lead.status}' — not starting new pipeline run`,
      skipped: true,
    });
  }

  // Create an enrichment job to anchor the run
  const { data: jobRow, error: jobErr } = await sb.from("enrichment_jobs").insert({
    lead_id: lead.id,
    contact_id: lead.contact_id,
    workflow_id: "pipeline_v2",
    job_type: "find_phone",
    status: "processing",
    started_at: new Date().toISOString(),
    raw_input: { leadId: lead.id, contactId: lead.contact_id, pipeline: "multi_stage_v2" },
  }).select("id").single();
  if (jobErr || !jobRow) {
    return NextResponse.json({ ok: false, error: jobErr?.message ?? "job insert failed" }, { status: 500 });
  }
  const enrichmentJobId = (jobRow as { id: string }).id;

  // Set lead to enrichment_pending
  await sb.from("leads").update({ status: "enrichment_pending" }).eq("id", lead.id);

  // Build LeadContext
  // Detect secondary contact name from full_name parsing: "A / B" or "A et B"
  const rawFullName = lead.contacts?.full_name ?? null;
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

  const ctx: LeadContext = {
    leadId: lead.id,
    contactId: lead.contact_id,
    enrichmentJobId,
    fullName: primaryName,
    companyName: lead.contacts?.company_name ?? null,
    secondaryName,
    propertyAddress: lead.properties?.address ?? null,
    propertyCity: lead.properties?.city ?? null,
    mailingAddress: lead.contacts?.mailing_address ?? null,
    mailingCity: lead.contacts?.mailing_city ?? null,
    mailingPostal: lead.contacts?.mailing_postal ?? null,
    matricule: lead.properties?.matricule ?? null,
    numUnits: lead.properties?.num_units ?? null,
  };

  // Run pipeline
  let result: Awaited<ReturnType<typeof runEnrichmentPipeline>>;
  try {
    result = await runEnrichmentPipeline(sb, ctx);
  } catch (err) {
    // Mark job failed
    await sb.from("enrichment_jobs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: (err as Error).message,
    }).eq("id", enrichmentJobId);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }

  // Mark job status
  const jobStatus = result.foundCandidates
    ? "completed"
    : result.openclawDispatched
      ? "processing"   // still waiting for OpenClaw callback
      : "failed";

  await sb.from("enrichment_jobs").update({
    status: jobStatus,
    completed_at: result.openclawDispatched ? undefined : new Date().toISOString(),
    raw_output: {
      stageReached: result.stageReached,
      candidateIds: result.candidateIds,
      openclawDispatched: result.openclawDispatched,
    },
  }).eq("id", enrichmentJobId);

  return NextResponse.json({
    ok: true,
    data: {
      enrichmentJobId,
      stageReached: result.stageReached,
      foundCandidates: result.foundCandidates,
      candidateCount: result.candidateIds.length,
      openclawDispatched: result.openclawDispatched,
      message: result.foundCandidates
        ? `Found ${result.candidateIds.length} candidate(s) at stage '${result.stageReached}'. Check phone review queue.`
        : result.openclawDispatched
          ? "All direct stages exhausted. OpenClaw deep search dispatched — check back when callback arrives."
          : "No candidates found after all stages. Lead marked unresolved_after_all_sources.",
    },
  });
}
