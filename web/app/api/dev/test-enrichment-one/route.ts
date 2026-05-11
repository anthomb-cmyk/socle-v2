// POST /api/dev/test-enrichment-one
//
// Admin-only. Picks the first lead that has no phone number and runs the
// full W7 address-first enrichment pipeline on it.
//
// Safety constraints:
//   - Runs exactly ONE lead per call
//   - Never touches leads that already have a phone
//   - Returns full pipeline result for inspection — no silent side-effects beyond what
//     the pipeline itself does (phone_candidates rows, enrichment_events)
//
// Use this endpoint to verify W7 is wired correctly before running bulk enrichment.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { runEnrichmentPipeline } from "@/lib/enrichment/pipeline";
import type { LeadContext } from "@/lib/enrichment/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type LeadRow = {
  id: string;
  contact_id: string;
  status: string;
  properties: {
    address: string;
    city: string | null;
    matricule: string | null;
    num_units: number | null;
  } | null;
  contacts: {
    id: string;
    full_name: string | null;
    company_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
  } | null;
};

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();

  // ── Pick first lead with no phone ──────────────────────────────────────
  // Use leads_view.best_phone to exclude any lead that already has a phone
  // (imported or previously enriched). Exclude leads already in enrichment.
  const activeStatuses = [
    "enrichment_running", "searching_address", "searching_company",
    "openclaw_researching", "needs_phone_review",
    "ready_to_call", "in_outreach", "meeting_set", "qualified",
    "phone_verified",
  ];

  const { data: candidateLeads } = await sb
    .from("leads_view")
    .select("lead_id, best_phone")
    .is("best_phone", null)
    .limit(20);

  if (!candidateLeads || candidateLeads.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "No leads without a phone found. Either all leads have phones, or leads_view is not populated.",
    });
  }

  // Filter out any in active enrichment statuses
  const { data: leadsRaw } = await sb
    .from("leads")
    .select(`
      id, contact_id, status,
      properties ( address, city, matricule, num_units ),
      contacts ( id, full_name, company_name, mailing_address, mailing_city, mailing_postal )
    `)
    .in("id", candidateLeads.map(r => (r as { lead_id: string }).lead_id))
    .not("status", "in", `(${activeStatuses.map(s => `"${s}"`).join(",")})`)
    .limit(1);

  const lead = (leadsRaw?.[0] as LeadRow | null | undefined) ?? null;

  if (!lead) {
    return NextResponse.json({
      ok: false,
      error: "All phone-less leads are currently in active enrichment status. Try again in a minute.",
    });
  }

  // ── Create enrichment job ───────────────────────────────────────────────
  const { data: jobRow, error: jobErr } = await sb.from("enrichment_jobs").insert({
    lead_id:     lead.id,
    contact_id:  lead.contact_id,
    workflow_id: "pipeline_v2_address_first",
    job_type:    "find_phone",
    status:      "processing",
    started_at:  new Date().toISOString(),
    raw_input:   { leadId: lead.id, source: "admin_test_panel" },
  }).select("id").single();

  if (jobErr || !jobRow) {
    return NextResponse.json({ ok: false, error: jobErr?.message ?? "job insert failed" }, { status: 500 });
  }
  const enrichmentJobId = (jobRow as { id: string }).id;

  // ── Build LeadContext ───────────────────────────────────────────────────
  const rawFullName = lead.contacts?.full_name ?? null;
  let primaryName: string | null = null;
  let secondaryName: string | null = null;
  if (rawFullName) {
    const sep = rawFullName.match(/\s*[\/|]\s*|\s+et\s+|\s+and\s+/i);
    if (sep?.index !== undefined) {
      primaryName   = rawFullName.slice(0, sep.index).trim() || null;
      secondaryName = rawFullName.slice(sep.index + sep[0].length).trim() || null;
    } else {
      primaryName = rawFullName;
    }
  }

  const ctx: LeadContext = {
    leadId:          lead.id,
    contactId:       lead.contact_id,
    enrichmentJobId,
    fullName:        primaryName,
    companyName:     lead.contacts?.company_name ?? null,
    secondaryName,
    propertyAddress: lead.properties?.address ?? null,
    propertyCity:    lead.properties?.city ?? null,
    mailingAddress:  lead.contacts?.mailing_address ?? null,
    mailingCity:     lead.contacts?.mailing_city ?? null,
    mailingPostal:   lead.contacts?.mailing_postal ?? null,
    matricule:       lead.properties?.matricule ?? null,
    numUnits:        lead.properties?.num_units ?? null,
  };

  // ── Run pipeline ────────────────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof runEnrichmentPipeline>>;
  try {
    result = await runEnrichmentPipeline(sb, ctx);
  } catch (err) {
    await sb.from("enrichment_jobs").update({
      status:        "failed",
      completed_at:  new Date().toISOString(),
      error_message: (err as Error).message,
    }).eq("id", enrichmentJobId);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }

  // ── Update job record ───────────────────────────────────────────────────
  const jobStatus = result.outcome === "openclaw_dispatched" ? "processing"
    : result.outcome === "unresolved" ? "failed" : "completed";

  await sb.from("enrichment_jobs").update({
    status:       jobStatus,
    completed_at: result.openclawDispatched ? undefined : new Date().toISOString(),
    raw_output:   { outcome: result.outcome, stageReached: result.stageReached, candidateIds: result.candidateIds, pipeline: result.pipeline },
  }).eq("id", enrichmentJobId);

  // ── Fetch candidates for response ───────────────────────────────────────
  const { data: candidatesRaw } = await sb
    .from("phone_candidates")
    .select("phone_raw, phone_e164, stage, matched_on, source_label, source_url, initial_confidence, snippet, search_query")
    .in("id", result.candidateIds);

  const messages: Record<string, string> = {
    solved:              `Phone auto-attached at stage '${result.stageReached}'. Lead is ready_to_call.`,
    review:              `${result.candidateIds.length} candidate(s) queued for review at stage '${result.stageReached}'. Go to /review.`,
    openclaw_dispatched: "All stages exhausted. OpenClaw deep search dispatched — check back after callback.",
    unresolved:          "No candidates found after all stages.",
  };

  return NextResponse.json({
    ok: true,
    data: {
      leadId:         lead.id,
      leadName:       rawFullName ?? lead.contacts?.company_name ?? null,
      leadAddress:    lead.contacts?.mailing_address ?? lead.properties?.address ?? null,
      outcome:        result.outcome,
      stageReached:   result.stageReached,
      candidateCount: result.candidateIds.length,
      candidates:     (candidatesRaw ?? []).map(c => ({
        phoneRaw:          (c as Record<string, unknown>).phone_raw,
        phoneE164:         (c as Record<string, unknown>).phone_e164,
        stage:             (c as Record<string, unknown>).stage,
        matchedOn:         (c as Record<string, unknown>).matched_on,
        sourceLabel:       (c as Record<string, unknown>).source_label,
        sourceUrl:         (c as Record<string, unknown>).source_url,
        initialConfidence: (c as Record<string, unknown>).initial_confidence,
        snippet:           (c as Record<string, unknown>).snippet,
        searchQuery:       (c as Record<string, unknown>).search_query,
      })),
      message: messages[result.outcome] ?? result.outcome,
    },
  });
}
