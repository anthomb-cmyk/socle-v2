// POST /api/enrichment/bulk-start
//
// Triggers the enrichment pipeline for all leads in a given import job
// (or a list of lead IDs). Authenticated via x-service-key header.
//
// Body: { importJobId: string } OR { leadIds: string[] }
// Header: x-service-key: <SUPABASE_SERVICE_ROLE_KEY>
//
// Processes leads sequentially with a small delay to avoid rate-limiting.
// Returns counts: { total, skipped, queued, failed }

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { runEnrichmentPipeline } from "@/lib/enrichment/pipeline";
import type { LeadContext } from "@/lib/enrichment/types";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — enough for ~100 leads sync

const DELAY_MS = 300; // ms between leads to avoid API rate limits

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  // ── Auth via service role key ────────────────────────────────────────────
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const provided = request.headers.get("x-service-key");
  if (!provided || provided !== serviceKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const sb = createSupabaseAdminClient();

  // ── Resolve lead IDs ─────────────────────────────────────────────────────
  let leadIds: string[] = [];

  if (body.leadIds && Array.isArray(body.leadIds)) {
    leadIds = body.leadIds as string[];
  } else if (body.importJobId) {
    const { data } = await sb
      .from("leads")
      .select("id")
      .eq("source_import_job_id", body.importJobId)
      .in("status", ["new", "needs_enrichment"]);
    leadIds = (data ?? []).map((r: { id: string }) => r.id);
  } else {
    return NextResponse.json(
      { ok: false, error: "Provide importJobId or leadIds" },
      { status: 400 },
    );
  }

  if (leadIds.length === 0) {
    return NextResponse.json({ ok: true, data: { total: 0, skipped: 0, queued: 0, failed: 0 } });
  }

  let skipped = 0, queued = 0, failed = 0;
  const errors: { leadId: string; error: string }[] = [];

  for (const leadId of leadIds) {
    try {
      // Load lead
      const { data: leadRaw } = await sb
        .from("leads")
        .select(`id, contact_id, status, properties(address,city,matricule,num_units), contacts(id,full_name,company_name,mailing_address,mailing_city,mailing_postal)`)
        .eq("id", leadId)
        .single();

      const lead = leadRaw as LeadRow | null;
      if (!lead) { failed++; continue; }

      // Skip if already has a phone
      const { data: viewRow } = await sb
        .from("leads_view")
        .select("best_phone")
        .eq("lead_id", leadId)
        .single();

      if (viewRow && (viewRow as { best_phone: string | null }).best_phone) {
        await sb.from("leads").update({ status: "ready_to_call" }).eq("id", leadId);
        skipped++;
        continue;
      }

      // Skip if actively running
      const activeStatuses = ["enrichment_running","enrichment_pending","openclaw_queued"];
      if (activeStatuses.includes(lead.status)) { skipped++; continue; }

      // Create enrichment job
      const { data: jobRow } = await sb.from("enrichment_jobs").insert({
        lead_id:     leadId,
        contact_id:  lead.contact_id,
        workflow_id: "pipeline_v2_address_first",
        job_type:    "find_phone",
        status:      "processing",
        started_at:  new Date().toISOString(),
        raw_input:   { leadId, pipeline: "address_first_v2", bulk: true },
      }).select("id").single();

      if (!jobRow) { failed++; continue; }
      const enrichmentJobId = (jobRow as { id: string }).id;

      await sb.from("leads").update({ status: "enrichment_pending" }).eq("id", leadId);

      // Build context
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
        leadId,
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

      // Run pipeline
      try {
        const result = await runEnrichmentPipeline(sb, ctx);
        const jobStatus = result.outcome === "openclaw_dispatched" ? "processing"
          : result.outcome === "unresolved" ? "failed" : "completed";
        await sb.from("enrichment_jobs").update({
          status:       jobStatus,
          completed_at: result.openclawDispatched ? undefined : new Date().toISOString(),
          raw_output:   { outcome: result.outcome, stageReached: result.stageReached },
        }).eq("id", enrichmentJobId);
        queued++;
      } catch (pipeErr) {
        await sb.from("enrichment_jobs").update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: (pipeErr as Error).message,
        }).eq("id", enrichmentJobId);
        errors.push({ leadId, error: (pipeErr as Error).message });
        failed++;
      }

      await sleep(DELAY_MS);

    } catch (err) {
      errors.push({ leadId, error: (err as Error).message });
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      total:   leadIds.length,
      skipped,
      queued,
      failed,
      errors:  errors.slice(0, 10), // cap error list
    },
  });
}
