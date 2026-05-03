// POST /api/enrichment/force-openclaw
//
// Admin-only. Dispatches a single lead directly to OpenClaw (Stage 3),
// skipping Stages 1 and 2 (address_search / company_search).
//
// Use this for leads already known to have failed Stages 1/2
// (e.g. status = unresolved_after_brave, unresolved_after_address,
// unresolved_after_company) that should now be handed off to the
// automated browser researcher.
//
// Outcomes:
//   openclaw_dispatched   → lead status = openclaw_researching
//                           event: openclaw_dispatched
//   webhook_missing       → lead status = unresolved_after_openclaw
//                           event: unresolved_after_openclaw (reason: no webhook URL)
//   already_has_phone     → skipped, 200 ok with explanation
//   already_researching   → 400, lead is already in openclaw_researching

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { requestOpenclawDeepSearch } from "@/lib/enrichment/openclaw-validate";
import type { LeadContext } from "@/lib/enrichment/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const Body = z.object({
  leadId: z.string().uuid(),
});

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

  // ── Load lead ──────────────────────────────────────────────────────────────
  const { data: leadRaw } = await sb
    .from("leads")
    .select(`
      id, contact_id, status,
      properties ( address, city, matricule, num_units ),
      contacts ( id, full_name, company_name, mailing_address, mailing_city, mailing_postal )
    `)
    .eq("id", body.leadId)
    .single();

  const lead = leadRaw as LeadRow | null;
  if (!lead) {
    return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  }

  // ── Guard: already being researched ───────────────────────────────────────
  if (lead.status === "openclaw_researching") {
    return NextResponse.json(
      { ok: false, error: "Lead is already in openclaw_researching — not dispatching again." },
      { status: 400 },
    );
  }

  // ── Gate: already has a phone ──────────────────────────────────────────────
  const { data: viewRow } = await sb
    .from("leads_view")
    .select("best_phone")
    .eq("lead_id", lead.id)
    .single();

  const bestPhone = (viewRow as { best_phone: string | null } | null)?.best_phone ?? null;
  if (bestPhone) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      data: { message: "Lead already has a phone — no enrichment needed.", bestPhone },
    });
  }

  // ── Create enrichment job ──────────────────────────────────────────────────
  const { data: jobRow, error: jobErr } = await sb.from("enrichment_jobs").insert({
    lead_id:     lead.id,
    contact_id:  lead.contact_id,
    workflow_id: "force_openclaw_v3",
    job_type:    "find_phone",
    status:      "processing",
    started_at:  new Date().toISOString(),
    raw_input:   {
      leadId:        lead.id,
      source:        "admin_force_openclaw",
      prior_status:  lead.status,
    },
  }).select("id").single();

  if (jobErr || !jobRow) {
    return NextResponse.json(
      { ok: false, error: jobErr?.message ?? "job insert failed" },
      { status: 500 },
    );
  }
  const enrichmentJobId = (jobRow as { id: string }).id;

  // ── Build LeadContext ──────────────────────────────────────────────────────
  const rawFullName = lead.contacts?.full_name ?? null;
  let primaryName: string | null = rawFullName;
  let secondaryName: string | null = null;
  if (rawFullName) {
    const sep = rawFullName.match(/\s*[\/|]\s*|\s+et\s+|\s+and\s+/i);
    if (sep?.index !== undefined) {
      primaryName   = rawFullName.slice(0, sep.index).trim() || null;
      secondaryName = rawFullName.slice(sep.index + sep[0].length).trim() || null;
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

  // ── Set status + log dispatch intent ──────────────────────────────────────
  await sb.from("leads").update({ status: "openclaw_researching" }).eq("id", lead.id);
  await sb.from("enrichment_events").insert({
    lead_id:    lead.id,
    event_type: "openclaw_dispatched",
    stage:      "openclaw",
    payload:    {
      prior_status:       lead.status,
      prior_candidate_ids: [],
      stages_tried:        ["address_search", "company_search"],
      source:              "admin_force_openclaw",
    },
  });

  // ── Dispatch ───────────────────────────────────────────────────────────────
  const { dispatched, reason } = await requestOpenclawDeepSearch(ctx, []);

  if (!dispatched) {
    // Webhook not configured or call failed — mark unresolved
    await sb.from("leads").update({ status: "unresolved_after_openclaw" }).eq("id", lead.id);
    await sb.from("enrichment_events").insert({
      lead_id:    lead.id,
      event_type: "unresolved_after_openclaw",
      stage:      "openclaw",
      payload:    {
        reason:  reason ?? "OPENCLAW_WEBHOOK_URL not configured",
        source:  "admin_force_openclaw",
      },
    });
    await sb.from("enrichment_jobs").update({
      status:        "failed",
      completed_at:  new Date().toISOString(),
      error_message: reason ?? "OPENCLAW_WEBHOOK_URL not configured",
    }).eq("id", enrichmentJobId);

    return NextResponse.json({
      ok: true,
      data: {
        outcome:  "webhook_missing",
        leadId:   lead.id,
        status:   "unresolved_after_openclaw",
        reason:   reason ?? "OPENCLAW_WEBHOOK_URL not configured",
        message:  "OpenClaw webhook not configured. Lead marked unresolved_after_openclaw. Set OPENCLAW_WEBHOOK_URL in Railway env vars.",
      },
    });
  }

  // ── Dispatched ────────────────────────────────────────────────────────────
  // Lead stays openclaw_researching until callback arrives at /api/enrichment/openclaw-callback
  await sb.from("enrichment_jobs").update({
    status: "processing",
    // completed_at intentionally omitted — job finishes at callback
  }).eq("id", enrichmentJobId);

  return NextResponse.json({
    ok: true,
    data: {
      outcome:         "openclaw_dispatched",
      leadId:          lead.id,
      enrichmentJobId,
      status:          "openclaw_researching",
      message:         "OpenClaw dispatched. Lead set to openclaw_researching — check /admin/events for callback.",
    },
  });
}
