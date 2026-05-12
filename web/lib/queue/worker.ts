// Queue worker — picks pending tasks from lead_post_processing_queue and
// dispatches them to the appropriate handler.
//
// Called from /api/cron/process-queue (Railway cron, every minute).
// Auto-fails tasks after 3 attempts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateBriefing } from "@/lib/llm/briefing";
import { scoreLeadFit } from "@/lib/llm/fit-scorer";
import { runEnrichmentPipeline } from "@/lib/enrichment/pipeline";

const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_MAX_RUNTIME_MS = 240_000; // 240 s — Railway HTTP timeout is ~5 min, keep 60 s buffer
const CONCURRENCY = 3;                 // process up to 3 leads in parallel
                                        // safe ceiling: Brave handles 3 RPS easily,
                                        // n8n OpenClaw can run 3 concurrent browser sessions
const ZOMBIE_THRESHOLD_MS = 15 * 60_000; // rows stuck in 'running' for >15 min are reset

export interface WorkerOptions {
  batchSize?: number;
  maxRuntimeMs?: number;
}

export interface WorkerResult {
  processed: number;
  succeeded: number;
  failed: number;
}

interface QueueRow {
  id: string;
  lead_id: string;
  task_type: "briefing" | "fit_score" | "enrichment";
  attempts: number;
}

async function fetchPropertyOwnerNames(
  sb: SupabaseClient,
  propertyId: string | null,
): Promise<string[]> {
  if (!propertyId) return [];

  try {
    const { data, error } = await sb
      .from("property_contacts")
      .select("contacts ( full_name, company_name )")
      .eq("property_id", propertyId)
      .eq("relationship", "owner");

    if (error) {
      console.warn("[worker] co-owner lookup failed:", error.message);
      return [];
    }

    const names = new Set<string>();
    for (const row of data ?? []) {
      const contact = (row as { contacts?: { full_name?: string | null; company_name?: string | null } | null }).contacts;
      const name = contact?.full_name?.trim() || contact?.company_name?.trim() || "";
      if (name) names.add(name);
    }

    return [...names];
  } catch (err) {
    console.warn("[worker] co-owner lookup threw:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Process the next batch of pending tasks from lead_post_processing_queue.
 * Returns counts of processed / succeeded / failed tasks.
 */
export async function processNextBatch(
  sb: SupabaseClient,
  opts: WorkerOptions = {},
): Promise<WorkerResult> {
  const batchSize   = opts.batchSize    ?? DEFAULT_BATCH_SIZE;
  const maxRuntime  = opts.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  const startedAt   = Date.now();

  const result: WorkerResult = { processed: 0, succeeded: 0, failed: 0 };

  // ── Zombie sweep ─────────────────────────────────────────────────────────
  // Reset any queue rows that have been stuck in 'running' for longer than
  // ZOMBIE_THRESHOLD_MS.  This recovers jobs where the worker process was
  // killed mid-run (Railway restart, OOM, network timeout) leaving the row
  // permanently in 'running' without a heartbeat mechanism.
  try {
    const zombieCutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS).toISOString();
    await sb
      .from("lead_post_processing_queue")
      .update({ status: "pending", scheduled_for: new Date().toISOString() })
      .eq("status", "running")
      .lt("started_at", zombieCutoff);
  } catch (err) {
    // Non-fatal — log and continue so the main batch still runs.
    console.warn("[worker] zombie sweep failed:", err instanceof Error ? err.message : String(err));
  }

  // Fetch pending tasks ordered by priority then scheduled_for.
  const { data: rows, error: fetchErr } = await sb
    .from("lead_post_processing_queue")
    .select("id, lead_id, task_type, attempts")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("priority", { ascending: true })
    .order("scheduled_for", { ascending: true })
    .limit(batchSize);

  if (fetchErr || !rows || rows.length === 0) {
    if (fetchErr) console.error("[worker] fetch error:", fetchErr.message);
    return result;
  }

  // Process one queue row end-to-end (mark running → dispatch → mark done/failed/pending).
  // Used inside the concurrency-limited chunk loop below.
  const processRow = async (row: QueueRow): Promise<void> => {
    // Guard: a null lead_id means the queue row is malformed — fail it
    // immediately rather than propagating null into dispatch() where it
    // would create a zombie enrichment_jobs row and then crash.
    if (!row.lead_id) {
      console.error(`[worker] task ${row.id} has null lead_id — failing immediately`);
      await sb
        .from("lead_post_processing_queue")
        .update({ status: "failed", last_error: "null lead_id" })
        .eq("id", row.id);
      result.failed++;
      return;
    }

    // Mark as running
    await sb
      .from("lead_post_processing_queue")
      .update({ status: "running", started_at: new Date().toISOString(), attempts: row.attempts + 1 })
      .eq("id", row.id);

    let success = false;
    let lastError: string | null = null;

    try {
      await dispatch(sb, row.lead_id, row.task_type);
      success = true;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[worker] task ${row.id} (${row.task_type}) failed:`, lastError);
    }

    const newAttempts = row.attempts + 1;
    const autoFail    = !success && newAttempts >= MAX_ATTEMPTS;

    if (success) {
      result.succeeded++;
      await sb
        .from("lead_post_processing_queue")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", row.id);
    } else if (autoFail) {
      result.failed++;
      await sb
        .from("lead_post_processing_queue")
        .update({ status: "failed", last_error: lastError })
        .eq("id", row.id);
    } else {
      // Back to pending with backoff: retry after attempts * 2 minutes
      const backoffMs = newAttempts * 2 * 60_000;
      await sb
        .from("lead_post_processing_queue")
        .update({
          status:         "pending",
          last_error:     lastError,
          scheduled_for:  new Date(Date.now() + backoffMs).toISOString(),
        })
        .eq("id", row.id);
    }
  };

  // Chunk the rows into groups of CONCURRENCY and process each group in parallel.
  // Each row's status updates and retry/backoff logic are unchanged — only the
  // outer iteration is parallelised.
  const queueRows = rows as QueueRow[];
  for (let i = 0; i < queueRows.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > maxRuntime) break;
    const chunk = queueRows.slice(i, i + CONCURRENCY);
    result.processed += chunk.length;
    await Promise.allSettled(chunk.map(processRow));
  }

  return result;
}

async function dispatch(
  sb: SupabaseClient,
  leadId: string,
  taskType: "briefing" | "fit_score" | "enrichment",
): Promise<void> {
  if (taskType === "briefing") {
    const briefing = await generateBriefing(leadId, sb);
    if (briefing) {
      await sb.from("leads").update({
        briefing_text:         briefing.text,
        briefing_generated_at: new Date().toISOString(),
        briefing_metadata:     briefing.metadata,
      }).eq("id", leadId);
    }
    return;
  }

  if (taskType === "fit_score") {
    await scoreLeadFit(leadId, sb);
    return;
  }

  if (taskType === "enrichment") {
    // Build a minimal LeadContext from the lead + contact records.
    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .select(`
        id, contact_id, property_id,
        contacts ( full_name, company_name, mailing_address, mailing_city, mailing_postal, mailing_civic, mailing_street, mailing_unit, mailing_province, mailing_postal_fsa ),
        properties ( address, city, matricule, num_units )
      `)
      .eq("id", leadId)
      .single();

    if (leadErr || !lead) {
      throw new Error(`lead fetch failed: ${leadErr?.message ?? "not found"}`);
    }

    const contact    = (lead as Record<string, unknown>).contacts as Record<string, unknown> | null;
    const property   = (lead as Record<string, unknown>).properties as Record<string, unknown> | null;
    const contactId  = (lead as Record<string, unknown>).contact_id as string;
    const propertyId = (lead as Record<string, unknown>).property_id as string | null;
    const relatedOwnerNames = await fetchPropertyOwnerNames(sb, propertyId);

    // Create a minimal enrichment_jobs row so pipeline logging works.
    // NOTE: enrichment_jobs has no property_id column — do NOT include it here,
    // or the insert will silently fail and downstream phone_candidates inserts
    // will reject the synthetic fallback id as a non-uuid.
    const { data: jobRow, error: jobInsertErr } = await sb.from("enrichment_jobs").insert({
      lead_id:     leadId,
      contact_id:  contactId,
      job_type:    "find_phone",
      workflow_id: "queue_worker",
      status:      "processing",
    }).select("id").single();

    if (jobInsertErr || !jobRow) {
      // Fail loudly — the queue dispatcher will record last_error and retry.
      // Better than silently propagating a synthetic non-uuid id downstream.
      throw new Error(`enrichment_jobs insert failed: ${jobInsertErr?.message ?? "no row returned"}`);
    }

    const ctx = {
      leadId,
      contactId,
      enrichmentJobId: (jobRow as { id: string }).id,
      fullName:        (contact?.full_name as string | null) ?? null,
      companyName:     (contact?.company_name as string | null) ?? null,
      secondaryName:   null,
      relatedOwnerNames,
      propertyAddress: (property?.address as string | null) ?? null,
      propertyCity:    (property?.city as string | null) ?? null,
      mailingAddress:  (contact?.mailing_address as string | null) ?? null,
      mailingCity:     (contact?.mailing_city as string | null) ?? null,
      mailingPostal:   (contact?.mailing_postal as string | null) ?? null,
      matricule:       (property?.matricule as string | null) ?? null,
      numUnits:        (property?.num_units as number | null) ?? null,
    };

    let pipelineResult: Awaited<ReturnType<typeof runEnrichmentPipeline>>;
    try {
      pipelineResult = await runEnrichmentPipeline(sb, ctx);
    } catch (pipeErr) {
      // runEnrichmentPipeline is documented to never throw, but guard anyway.
      // If it does throw, mark the enrichment_jobs row as failed so it doesn't
      // stay stuck at 'processing' (zombie).
      const pipeErrMsg = pipeErr instanceof Error ? pipeErr.message : String(pipeErr);
      await sb.from("enrichment_jobs").update({
        status:        "failed",
        completed_at:  new Date().toISOString(),
        error_message: pipeErrMsg,
      }).eq("id", (jobRow as { id: string }).id);
      throw pipeErr; // re-throw so processRow can retry via the queue
    }

    // Update the enrichment job with the outcome.
    await sb.from("enrichment_jobs").update({
      status:       pipelineResult.outcome === "unsuitable" || pipelineResult.outcome === "unresolved" ? "failed" : "completed",
      completed_at: new Date().toISOString(),
      raw_output:   { outcome: pipelineResult.outcome, stageReached: pipelineResult.stageReached, pipeline: pipelineResult.pipeline },
    }).eq("id", (jobRow as { id: string }).id);

    // Safety net: the pipeline is expected to update the lead status internally
    // (via publishOwnerRecordToCrm or setLeadStatus), but if it fails silently
    // (e.g. publishOwnerRecordToCrm throws and is caught) the lead can remain
    // stuck at 'enrichment_running' forever.  Re-check the lead's current status
    // and, if it is still 'enrichment_running', apply the correct next-state
    // derived from the pipeline outcome.
    const { data: leadNow } = await sb
      .from("leads")
      .select("status")
      .eq("id", leadId)
      .single();
    const currentStatus = (leadNow as { status: string } | null)?.status ?? "";

    if (currentStatus === "enrichment_running") {
      // Map pipeline outcome → lead status (mirrors crm-bridge + pipeline logic)
      let fallbackStatus: string;
      switch (pipelineResult.outcome) {
        case "solved":
          fallbackStatus = "ready_to_call";
          break;
        case "review":
          fallbackStatus = "needs_phone_review";
          break;
        case "openclaw_dispatched":
          fallbackStatus = "openclaw_researching";
          break;
        default:
          // "unresolved" | "unsuitable" | any unknown outcome
          fallbackStatus = "unresolved_after_all_sources";
          break;
      }
      console.warn(
        `[worker] lead ${leadId} still 'enrichment_running' after pipeline (outcome=${pipelineResult.outcome}); forcing → ${fallbackStatus}`,
      );
      await sb.from("leads").update({ status: fallbackStatus }).eq("id", leadId);
    }
    return;
  }

  throw new Error(`unknown task_type: ${taskType}`);
}
