// POST /api/enrichment-jobs/batch
// Body: { leadIds: uuid[], jobType: string, force?: boolean }
//
// Creates enrichment jobs then processes them via the new /api/enrichment/run
// runner pipeline (Brave search + page fetch + deterministic scoring + auto-attach).
// Concurrency = 5. No n8n webhook fired.
//
// Returns per-lead { leadId, status: 'created'|'skipped'|'failed', jobId?, error? }.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const maxDuration = 300;

const JOB_TYPES = ["find_phone", "verify_phone", "find_email", "find_website", "owner_identity", "property_context", "general_research"] as const;
const NON_TERMINAL = ["pending", "processing"] as const;

const Body = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500),
  jobType: z.enum(JOB_TYPES),
  force: z.boolean().optional(),
});

// Simple concurrency limiter — no extra deps needed.
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(workers);
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // Hydrate leads → contact_id + enrichment info (in one query via leads_view)
  const { data: leadRows } = await sb.from("leads_view")
    .select("lead_id, contact_id, full_name, company_name, address, city, num_units, best_phone")
    .in("lead_id", body.leadIds);

  type LeadInfo = {
    contact_id: string;
    full_name: string | null;
    company_name: string | null;
    address: string;
    city: string | null;
    num_units: number | null;
    best_phone: string | null;
  };
  const leadMap = new Map<string, LeadInfo>(
    ((leadRows ?? []) as Array<{ lead_id: string } & LeadInfo>).map(l => [l.lead_id, l]),
  );

  // Existing non-terminal jobs of same type (for the skip check)
  let existingByLead = new Map<string, string>();
  if (!body.force) {
    const { data: existing } = await sb.from("enrichment_jobs")
      .select("id, lead_id, status")
      .in("lead_id", body.leadIds)
      .eq("job_type", body.jobType)
      .in("status", NON_TERMINAL as unknown as string[]);
    existingByLead = new Map<string, string>(
      ((existing ?? []) as Array<{ id: string; lead_id: string }>).map(e => [e.lead_id, e.id]),
    );
  }

  const results: Array<{ leadId: string; status: "created" | "skipped" | "failed"; jobId?: string; error?: string }> = [];

  // Phase 1: insert all jobs
  const jobsToRun: Array<{ leadId: string; jobId: string; leadInfo: LeadInfo }> = [];

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
      lead_id: leadId,
      contact_id: contactId,
      workflow_id: "force_openclaw_v3",
      job_type: body.jobType,
      status: "pending",
      raw_input: { leadId, contactId, jobType: body.jobType, requestedBy: user.id, batch: true },
    }).select("id").single();

    if (ins.error || !ins.data) {
      results.push({ leadId, status: "failed", error: ins.error?.message ?? "insert failed" });
      continue;
    }
    const jobId = (ins.data as { id: string }).id;
    results.push({ leadId, status: "created", jobId });
    jobsToRun.push({ leadId, jobId, leadInfo });
  }

  // Phase 2: process each job via the enrichment runner (concurrency = 5)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const sharedKey = process.env.N8N_SHARED_KEY ?? "";

  await runWithConcurrency(jobsToRun, 5, async ({ leadId, jobId }) => {
    // Intentionally DO NOT send lead_context — leads_view doesn't have mailing
    // fields (those live on contacts), and a partial lead_context blocks the
    // runner's DB-fallback path (which only fires when lead_context is absent
    // entirely). Letting the runner DB-fetch full context per lead means it
    // gets mailing_address/city/postal and can build the full 10-query set.
    try {
      await fetch(`${appUrl}/api/enrichment/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sharedKey}`,
        },
        body: JSON.stringify({
          enrichment_job_id: jobId,
          lead_id: leadId,
        }),
      });
      // runner handles its own DB writes (job status, candidates, phone attach)
    } catch {
      // swallow — the job row remains in DB; watchdog or retry can pick it up
    }
  });

  const counts = {
    created: results.filter(r => r.status === "created").length,
    skipped: results.filter(r => r.status === "skipped").length,
    failed:  results.filter(r => r.status === "failed").length,
  };

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "enrichment_jobs_batch_created",
    status: counts.failed > 0 ? "partial" : "success",
    triggered_by: user.id,
    payload: { jobType: body.jobType, leadIdCount: body.leadIds.length, force: !!body.force, runner: "force_openclaw_v3" },
    result: counts,
  });

  return NextResponse.json({ ok: true, data: { counts, results } });
}
