// Enqueue a post-processing task for a lead.
//
// Idempotent: if a 'pending' task of the same (lead_id, task_type) already
// exists, the upsert is a no-op (ignoreDuplicates). This prevents double-
// queueing when import-commit and autoAttachPhone both try to enqueue.

import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskType = "briefing" | "fit_score" | "enrichment";

/**
 * Enqueue a post-processing task. Safe to call multiple times — duplicate
 * pending tasks are silently ignored.
 *
 * @param sb    Supabase client (admin or server)
 * @param leadId  UUID of the lead to process
 * @param taskType  One of: 'briefing' | 'fit_score' | 'enrichment'
 * @param priority  Lower = higher priority. Default 5.
 */
export async function enqueue(
  sb: SupabaseClient,
  leadId: string,
  taskType: TaskType,
  priority = 5,
): Promise<void> {
  const { error } = await sb.from("lead_post_processing_queue").upsert(
    {
      lead_id:      leadId,
      task_type:    taskType,
      priority,
      status:       "pending",
      scheduled_for: new Date().toISOString(),
    },
    // Unique on (lead_id, task_type) when status='pending'.
    // We use a compound unique key indirectly: if a pending row with the same
    // lead_id + task_type exists, ignoreDuplicates prevents double insertion.
    // The index lead_post_processing_queue_lead_idx covers (lead_id, task_type).
    { onConflict: "lead_id,task_type", ignoreDuplicates: true },
  );

  if (error) {
    // Non-fatal: log but never throw. Queue failures must never break callers.
    console.error("[enqueue] failed to enqueue task:", { leadId, taskType, error: error.message });
  }
}
