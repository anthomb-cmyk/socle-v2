// Tests for the enqueue helper.
// Uses a mock Supabase client to verify upsert is called correctly.

import { describe, it, expect, vi } from "vitest";
import { enqueue } from "../enqueue";

function makeSb(upsertError: null | { message: string } = null) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError });
  const from = vi.fn().mockReturnValue({ upsert });
  return { sb: { from } as unknown as Parameters<typeof enqueue>[0], upsert, from };
}

describe("enqueue", () => {
  it("calls upsert on lead_post_processing_queue with correct fields", async () => {
    const { sb, from, upsert } = makeSb();
    await enqueue(sb, "lead-123", "briefing");
    expect(from).toHaveBeenCalledWith("lead_post_processing_queue");
    expect(upsert).toHaveBeenCalledOnce();
    const [payload, options] = upsert.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(payload.lead_id).toBe("lead-123");
    expect(payload.task_type).toBe("briefing");
    expect(payload.status).toBe("pending");
    expect(payload.priority).toBe(5);
    expect(options).toMatchObject({ onConflict: "lead_id,task_type", ignoreDuplicates: true });
  });

  it("respects custom priority", async () => {
    const { sb, upsert } = makeSb();
    await enqueue(sb, "lead-456", "fit_score", 3);
    const [payload] = upsert.mock.calls[0] as [Record<string, unknown>];
    expect(payload.priority).toBe(3);
  });

  it("does not throw when upsert returns an error", async () => {
    const { sb } = makeSb({ message: "conflict" });
    // Should not throw
    await expect(enqueue(sb, "lead-789", "enrichment")).resolves.toBeUndefined();
  });

  it("works for all task types", async () => {
    for (const taskType of ["briefing", "fit_score", "enrichment"] as const) {
      const { sb, upsert } = makeSb();
      await enqueue(sb, "lead-abc", taskType);
      const [payload] = upsert.mock.calls[0] as [Record<string, unknown>];
      expect(payload.task_type).toBe(taskType);
    }
  });
});
