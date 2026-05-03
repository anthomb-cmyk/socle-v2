// POST /api/enrichment/start
//
// Kicks off the address-first phone enrichment pipeline (v2) for one lead.
// Accepts: { leadId: uuid }
//
// Phone gate (Stage 0):
//   Checks leads_view.best_phone — if any phone already exists (from import or
//   prior enrichment), skip enrichment and return skipped=true.
//   This is stricter than the old gate which only checked for "verified" phones.
//
// Runs stages 1-2 synchronously (address → company),
// dispatches stage 3 (OpenClaw) asynchronously if both fail.

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

// Row shape returned by leads join
type LeadRow = {
  id:         string;
  contact_id: string;
  status:     string;
  properties: {
    address:    string;
    city:       string | null;
    matricule:  string | null;
    num_units:  number | null;
  } | null;
  contacts: {
    id:              string;
    full_name:       string | null;
    company_name:    string | null;
    mailing_address: string | null;
    mailing_city:    string | null;
    mailing_postal:  string | null;
  } | null;
};

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) {
    return NextResponse.json(
      { ok: false, error: "Bad input", errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  // ── Load lead context ───────────────────────────────────────────────────
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

  const lead = leadRaw as LeadRow | null;
  if (!lead) {
    return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  }

  // ── Stage 0: Existing phone gate ────────────────────────────────────────
  // Check leads_view.best_phone — any phone in DB (imported OR previously found)
  // prevents re-enrichment. Callers are expected to have the phone already.
  const { data: viewRow } = await sb
    .from("leads_view")
    .select("best_phone")
    .eq("lead_id", lead.id)
    .single();

  if (viewRow && (viewRow as { best_phone: string | null }).best_phone) {
    // Phone already exists — mark ready_to_call if not already
    if (!["ready_to_call", "in_outreach", "meeting_set", "qualified"].includes(lead.status)) {
      await sb.from("leads").update({ status: "ready_to_call" }).eq("id", lead.id);
      await sb.from("enrichment_events").insert({
        lead_id:    lead.id,
        event_type: "existing_phone_found",
        stage:      null,
        payload:    { best_phone: (viewRow as { best_phone: string }).best_phone, skipped: true },
      });
    }
    return NextResponse.json({
      ok: true,
      skipped: true,
      data: {
        message: "Lead already has a phone number — enrichment skipped.",
        bestPhone: (viewRow as { best_phone: string }).best_phone,
        leadStatus: "ready_to_call",
      },
    });
  }

  // ── Guard: skip if already actively running ─────────────────────────────
  const activeStatuses = [
    "enrichment_running",
    "searching_address",
    "searching_company",
    "openclaw_researching",
    "needs_phone_review",
  ];
  if (activeStatuses.includes(lead.status)) {
    return NextResponse.json({
      ok: false,
      error: `Lead is already in status '${lead.status}' — not starting new pipeline run.`,
      skipped: true,
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
    raw_input:   { leadId: lead.id, contactId: lead.contact_id, pipeline: "address_first_v2" },
  }).select("id").single();

  if (jobErr || !jobRow) {
    return NextResponse.json(
      { ok: false, error: jobErr?.message ?? "job insert failed" },
      { status: 500 },
    );
  }
  const enrichmentJobId = (jobRow as { id: string }).id;

  // Mark pending
  await sb.from("leads").update({ status: "enrichment_pending" }).eq("id", lead.id);

  // ── Build LeadContext ───────────────────────────────────────────────────
  // Split "Francis Morin / Jean Tremblay" or "A et B" → primary + secondary
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
  const jobStatus =
    result.outcome === "openclaw_dispatched" ? "processing"
    : result.outcome === "unresolved"         ? "failed"
    :                                           "completed";

  await sb.from("enrichment_jobs").update({
    status:       jobStatus,
    completed_at: result.openclawDispatched ? undefined : new Date().toISOString(),
    raw_output: {
      outcome:            result.outcome,
      stageReached:       result.stageReached,
      candidateIds:       result.candidateIds,
      openclawDispatched: result.openclawDispatched,
    },
  }).eq("id", enrichmentJobId);

  // ── Response ────────────────────────────────────────────────────────────
  const messages: Record<string, string> = {
    solved:             `Phone auto-attached (high confidence) at stage '${result.stageReached}'. Lead is ready_to_call.`,
    review:             `${result.candidateIds.length} candidate(s) queued for phone review at stage '${result.stageReached}'.`,
    openclaw_dispatched: "All direct stages exhausted. OpenClaw deep search dispatched — awaiting callback.",
    unresolved:         "No candidates found after all stages. Lead marked unresolved_after_openclaw.",
  };

  return NextResponse.json({
    ok:   true,
    data: {
      enrichmentJobId,
      outcome:        result.outcome,
      stageReached:   result.stageReached,
      candidateCount: result.candidateIds.length,
      message:        messages[result.outcome] ?? result.outcome,
    },
  });
}
