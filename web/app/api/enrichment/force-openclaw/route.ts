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
//   webhook_missing       → OPENCLAW_WEBHOOK_URL env var not set
//                           lead status = unresolved_after_openclaw
//                           event: unresolved_after_openclaw (reason: no webhook URL)
//   webhook_failed        → URL set but fetch threw or non-2xx
//                           lead status = unresolved_after_openclaw
//                           event: unresolved_after_openclaw (reason: <error>)
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
  // Pre-check the env var so we can distinguish "URL not configured" (webhook_missing)
  // from "URL set but fetch errored" (webhook_failed).
  const webhookConfigured = !!process.env.OPENCLAW_WEBHOOK_URL;
  const sharedKeySet      = !!process.env.N8N_SHARED_KEY;
  let webhookHost = "";
  try { webhookHost = process.env.OPENCLAW_WEBHOOK_URL ? new URL(process.env.OPENCLAW_WEBHOOK_URL).host : ""; }
  catch { webhookHost = "(invalid URL)"; }
  const dispatchTarget = {
    webhookConfigured,
    webhookHost,
    sharedKeySet,
  };

  let dispatched = false;
  let dispatchReason: string | null = null;

  if (!webhookConfigured) {
    dispatchReason = "OPENCLAW_WEBHOOK_URL not configured";
  } else {
    try {
      const result = await requestOpenclawDeepSearch(ctx, []);
      dispatched = result.dispatched;
      dispatchReason = result.reason ?? null;
    } catch (err) {
      dispatched = false;
      dispatchReason = (err as Error).message ?? "requestOpenclawDeepSearch threw unexpectedly";
    }
  }

  if (!dispatched) {
    // Either webhook_missing (env var unset) or webhook_failed (URL set but fetch failed/threw)
    const outcome: "webhook_missing" | "webhook_failed" = webhookConfigured
      ? "webhook_failed"
      : "webhook_missing";
    const errMsg = dispatchReason ?? "OpenClaw dispatch failed for unknown reason";
    const userMessage = outcome === "webhook_missing"
      ? "OPENCLAW_WEBHOOK_URL is not set. Lead marked unresolved_after_openclaw. Set the env var in Railway and retry."
      : `OpenClaw webhook fetch failed: ${errMsg}. Lead marked unresolved_after_openclaw. Check the OpenClaw n8n workflow / network reachability and retry.`;

    await sb.from("leads").update({ status: "unresolved_after_openclaw" }).eq("id", lead.id);
    await sb.from("enrichment_events").insert({
      lead_id:    lead.id,
      event_type: "unresolved_after_openclaw",
      stage:      "openclaw",
      payload:    { outcome, reason: errMsg, source: "admin_force_openclaw" },
    });
    await sb.from("enrichment_jobs").update({
      status:        "failed",
      completed_at:  new Date().toISOString(),
      error_message: errMsg,
    }).eq("id", enrichmentJobId);

    return NextResponse.json({
      ok: true,
      data: {
        outcome,
        leadId:   lead.id,
        enrichmentJobId,
        status:   "unresolved_after_openclaw",
        reason:   errMsg,
        dispatch: dispatchTarget,
        message:  userMessage,
      },
    });
  }

  // ── Dispatched ────────────────────────────────────────────────────────────
  // Job stays "processing" until callback arrives at /api/enrichment/openclaw-callback.
  // Dashboard stuck heuristic: processing > 60 min → shows as stuck.
  // completed_at intentionally omitted here — set by openclaw-callback route.
  return NextResponse.json({
    ok: true,
    data: {
      outcome:         "openclaw_dispatched",
      leadId:          lead.id,
      enrichmentJobId,
      status:          "openclaw_researching",
      dispatch:        dispatchTarget,
      message:         `OpenClaw dispatched to ${webhookHost}. Lead set to openclaw_researching — check /admin/enrichment for callback. If no callback within 10 min, /admin/enrichment shows a Mark Stale button.`,
    },
  });
}
