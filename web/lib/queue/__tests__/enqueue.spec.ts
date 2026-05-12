// Tests for the enqueue helper.
// Uses a mock Supabase client to verify upsert is called correctly.

import { describe, it, expect, vi } from "vitest";
import { enqueue } from "../enqueue";

function makeSb(opts: {
  existing?: { id: string; status: string; priority: number | null } | null;
  fetchError?: null | { message: string };
  insertError?: null | { message: string };
  updateError?: null | { message: string };
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.existing ?? null,
    error: opts.fetchError ?? null,
  });
  const selectChain: { eq: ReturnType<typeof vi.fn>; maybeSingle: typeof maybeSingle } = {
    eq: vi.fn(() => selectChain),
    maybeSingle,
  };
  const select = vi.fn(() => selectChain);
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });
  const updateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn().mockReturnValue({ select, insert, update });
  return { sb: { from } as unknown as Parameters<typeof enqueue>[0], from, select, selectChain, insert, update, updateEq, maybeSingle };
}

describe("enqueue", () => {
  it("inserts a pending task when none exists", async () => {
    const { sb, from, insert } = makeSb();
    await enqueue(sb, "lead-123", "briefing");
    expect(from).toHaveBeenCalledWith("lead_post_processing_queue");
    expect(insert).toHaveBeenCalledOnce();
    const [payload] = insert.mock.calls[0] as [Record<string, unknown>];
    expect(payload.lead_id).toBe("lead-123");
    expect(payload.task_type).toBe("briefing");
    expect(payload.status).toBe("pending");
    expect(payload.priority).toBe(5);
  });

  it("respects custom priority", async () => {
    const { sb, insert } = makeSb();
    await enqueue(sb, "lead-456", "fit_score", 3);
    const [payload] = insert.mock.calls[0] as [Record<string, unknown>];
    expect(payload.priority).toBe(3);
  });

  it("bumps an existing pending task to the higher priority", async () => {
    const { sb, update, updateEq, insert } = makeSb({
      existing: { id: "queue-123", status: "pending", priority: 7 },
    });
    await enqueue(sb, "lead-123", "enrichment", 1);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      priority: 1,
      scheduled_for: expect.any(String),
    }));
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ attempts: 0 }));
    expect(updateEq).toHaveBeenCalledWith("id", "queue-123");
  });

  it("resets a completed task so a re-import can run it again", async () => {
    const { sb, update, updateEq, insert } = makeSb({
      existing: { id: "queue-done", status: "done", priority: 5 },
    });
    await enqueue(sb, "lead-123", "enrichment", 1);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      priority: 1,
      status: "pending",
      attempts: 0,
      last_error: null,
      started_at: null,
      completed_at: null,
      scheduled_for: expect.any(String),
    }));
    expect(updateEq).toHaveBeenCalledWith("id", "queue-done");
  });

  it("leaves running tasks alone", async () => {
    const { sb, update, insert } = makeSb({
      existing: { id: "queue-running", status: "running", priority: 1 },
    });
    await enqueue(sb, "lead-123", "enrichment", 1);
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not throw when insert returns an error", async () => {
    const { sb } = makeSb({ insertError: { message: "conflict" } });
    // Should not throw
    await expect(enqueue(sb, "lead-789", "enrichment")).resolves.toBeUndefined();
  });

  it("works for all task types", async () => {
    for (const taskType of ["briefing", "fit_score", "enrichment"] as const) {
      const { sb, insert } = makeSb();
      await enqueue(sb, "lead-abc", taskType);
      const [payload] = insert.mock.calls[0] as [Record<string, unknown>];
      expect(payload.task_type).toBe(taskType);
    }
  });
});
