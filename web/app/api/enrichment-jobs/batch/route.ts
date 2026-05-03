// POST /api/enrichment-jobs/batch
// Body: { leadIds: uuid[], jobType: string, force?: boolean }
//
// For each lead:
//   - skip if a non-terminal job of the same job_type already exists (unless force=true)
//   - create the job
//   - if N8N_ENRICHMENT_WEBHOOK_URL is set, fire the webhook (best-effort; fail-safe)
// Returns per-lead { leadId, status: 'created'|'skipped'|'failed', jobId?, error? }.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const JOB_TYPES = ["find_phone", "verify_phone", "find_email", "find_website", "owner_identity", "property_context", "general_research"] as const;
const NON_TERMINAL = ["pending", "processing"] as const;

const Body = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500),
  jobType: z.enum(JOB_TYPES),
  force: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // Hydrate leads → contact_id + enrichment info (in one query via leads_view)
  const { data: leadRows } = await sb.from("leads_view")
    .select("lead_id, contact_id, full_name, company_name, address, city, num_units, best_phone")
    .in("lead_id", body.leadIds);
  type LeadInfo = { contact_id: string; full_name: string | null; company_name: string | null; address: string; city: string | null; num_units: number | null; best_phone: string | null };
  const leadMap = new Map<string, LeadInfo>(((leadRows ?? []) as Array<{ lead_id: string } & LeadInfo>).map(l => [l.lead_id, l]));

  // Existing non-terminal jobs of same type (for the skip check)
  let existingByLead = new Map<string, string>();
  if (!body.force) {
    const { data: existing } = await sb.from("enrichment_jobs")
      .select("id, lead_id, status")
      .in("lead_id", body.leadIds)
      .eq("job_type", body.jobType)
      .in("status", NON_TERMINAL as unknown as string[]);
    existingByLead = new Map<string, string>(((existing ?? []) as Array<{ id: string; lead_id: string }>).map(e => [e.lead_id, e.id]));
  }

  const results: Array<{ leadId: string; status: "created" | "skipped" | "failed"; jobId?: string; error?: string }> = [];
  const webhookUrl = process.env.N8N_ENRICHMENT_WEBHOOK_URL;

  for (const leadId of body.leadIds) {
    const leadInfo = leadMap.get(leadId);
    if (!leadInfo) {
      results.push({ leadId, status: "failed", error: "Lead not found" });
      continue;
    }
    const contactId = leadInfo.contact_id;
    if (!body.force && existingByLead.has(leadId)) {
      results.push({ leadId, status: "skipped", error: `existing ${body.jobType} job (${existingByLead.get(leadId)})` });
      continue;
    }

    const ins = await sb.from("enrichment_jobs").insert({
      lead_id: leadId, contact_id: contactId,
      workflow_id: `n8n_${body.jobType}`,
      job_type: body.jobType,
      status: "pending",
      raw_input: { leadId, contactId, jobType: body.jobType, requestedBy: user.id, batch: true },
    }).select("id").single();
    if (ins.error || !ins.data) {
      results.push({ leadId, status: "failed", error: ins.error?.message ?? "insert failed" });
      continue;
    }
    const jobId = (ins.data as { id: string }).id;

    // Best-effort webhook fire
    if (webhookUrl) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (process.env.N8N_SHARED_KEY) headers["Authorization"] = `Bearer ${process.env.N8N_SHARED_KEY}`;
        const r = await fetch(webhookUrl, {
          method: "POST", headers,
          body: JSON.stringify({
            enrichment_job_id: jobId,
            lead_id: leadId,
            contact_id: contactId,
            job_type: body.jobType,
            // Lead context so W7 can build a search query without a round-trip
            lead_info: {
              full_name: leadInfo.full_name,
              company_name: leadInfo.company_name,
              address: leadInfo.address,
              city: leadInfo.city,
              num_units: leadInfo.num_units,
              already_has_phone: !!leadInfo.best_phone,
            },
          }),
        });
        if (r.ok) {
          await sb.from("enrichment_jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", jobId);
        }
      } catch {
        // swallow — job stays pending
      }
    }

    results.push({ leadId, status: "created", jobId });
  }

  const counts = {
    created: results.filter(r => r.status === "created").length,
    skipped: results.filter(r => r.status === "skipped").length,
    failed: results.filter(r => r.status === "failed").length,
  };

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "enrichment_jobs_batch_created",
    status: counts.failed > 0 ? "partial" : "success",
    triggered_by: user.id,
    payload: { jobType: body.jobType, leadIdCount: body.leadIds.length, force: !!body.force, webhookConfigured: !!webhookUrl },
    result: counts,
  });

  return NextResponse.json({ ok: true, data: { counts, results } });
}
