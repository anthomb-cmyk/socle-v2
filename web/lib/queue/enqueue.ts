// Enqueue a post-processing task for a lead.
//
// Idempotent for active work, but reusable after completion: if the same
// lead/task was already done or failed in an older import, reset that row to
// pending so a new import can run the task again.

import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskType = "briefing" | "fit_score" | "enrichment";

/**
 * Enqueue a post-processing task. Safe to call multiple times: pending tasks
 * are rescheduled/bumped, running tasks are left alone, and completed/failed
 * tasks are reset for a new run.
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
  const scheduledFor = new Date().toISOString();

  const { data: existing, error: fetchError } = await sb
    .from("lead_post_processing_queue")
    .select("id, status, priority")
    .eq("lead_id", leadId)
    .eq("task_type", taskType)
    .maybeSingle();

  if (fetchError) {
    console.error("[enqueue] failed to inspect task:", { leadId, taskType, error: fetchError.message });
    return;
  }

  const row = existing as { id: string; status: string; priority: number | null } | null;

  if (row) {
    if (row.status === "running") return;

    const nextPriority = Math.min(row.priority ?? priority, priority);
    const update =
      row.status === "pending"
        ? { priority: nextPriority, scheduled_for: scheduledFor }
        : {
            priority: nextPriority,
            status: "pending",
            attempts: 0,
            last_error: null,
            scheduled_for: scheduledFor,
            started_at: null,
            completed_at: null,
          };

    const { error } = await sb
      .from("lead_post_processing_queue")
      .update(update)
      .eq("id", row.id);

    if (error) {
      console.error("[enqueue] failed to update task:", { leadId, taskType, error: error.message });
    }
    return;
  }

  const { error } = await sb.from("lead_post_processing_queue").insert({
    lead_id: leadId,
    task_type: taskType,
    priority,
    status: "pending",
    scheduled_for: scheduledFor,
  });

  if (error) {
    // Non-fatal: log but never throw. Queue failures must never break callers.
    console.error("[enqueue] failed to insert task:", { leadId, taskType, error: error.message });
  }
}
