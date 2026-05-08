import { describe, it, expect, vi } from "vitest";
import {
  insertEvidence,
  insertHypothesis,
  upsertOwnerRecord,
  findCanonicalOwnerById,
} from "../db";

// ---------------------------------------------------------------------------
// Mock builder factory — mirrors the shadow-client pattern from backtest/runner
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: unknown };

function makeChain(result: MockResult) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "upsert", "eq", "single"] as const;
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // .single() resolves to the final result
  (chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  return chain;
}

function makeSupabaseMock(result: MockResult, capturedTable = { name: "" }) {
  const chainRef = makeChain(result);
  const fromFn = vi.fn((table: string) => {
    capturedTable.name = table;
    return chainRef;
  });
  return { sb: { from: fromFn } as unknown as Parameters<typeof insertEvidence>[0], chain: chainRef, fromFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("insertEvidence", () => {
  it("calls from('evidence').insert().select().single() with the given payload", async () => {
    const expected = { evidence_id: "ev-1", owner_id: "owner-1", source: "neq_api", structured: {}, weight_at_fetch: 1.0 };
    const capturedTable = { name: "" };
    const { sb, fromFn, chain } = makeSupabaseMock({ data: expected, error: null }, capturedTable);

    const payload = {
      owner_id: "owner-1",
      source: "neq_api",
      source_url: null,
      query_text: null,
      raw_response: null,
      structured: { phones: [] },
      weight_at_fetch: 1.0,
    };

    const result = await insertEvidence(sb, payload);

    expect(fromFn).toHaveBeenCalledWith("evidence");
    expect(chain.insert).toHaveBeenCalledWith(payload);
    expect(chain.select).toHaveBeenCalled();
    expect(chain.single).toHaveBeenCalled();
    expect(result.data).toEqual(expected);
    expect(result.error).toBeNull();
  });
});

describe("insertHypothesis", () => {
  it("calls from('hypothesis').insert().select().single() with the given payload", async () => {
    const expected = { hypothesis_id: "hyp-1", owner_id: "owner-2", claim_type: "phone", claim_value: "+15141234567" };
    const capturedTable = { name: "" };
    const { sb, fromFn, chain } = makeSupabaseMock({ data: expected, error: null }, capturedTable);

    const payload = {
      owner_id: "owner-2",
      claim_type: "phone" as const,
      claim_value: "+15141234567",
      claim_value_e164: "+15141234567",
      tier: "A" as const,
      confidence_label: "confirmed" as const,
      is_direct: true,
      status: "candidate" as const,
      status_reason: null,
      evidence_ids: ["ev-1"],
    };

    const result = await insertHypothesis(sb, payload);

    expect(fromFn).toHaveBeenCalledWith("hypothesis");
    expect(chain.insert).toHaveBeenCalledWith(payload);
    expect(chain.select).toHaveBeenCalled();
    expect(chain.single).toHaveBeenCalled();
    expect(result.data).toEqual(expected);
    expect(result.error).toBeNull();
  });
});

describe("upsertOwnerRecord", () => {
  it("calls from('owner_record').upsert() with onConflict owner_id,snapshot_hash", async () => {
    const expected = { record_id: "rec-1", owner_id: "owner-3", snapshot_hash: "abc123" };
    const capturedTable = { name: "" };
    const { sb, fromFn, chain } = makeSupabaseMock({ data: expected, error: null }, capturedTable);

    const payload = {
      owner_id: "owner-3",
      snapshot_hash: "abc123",
      primary_phone_e164: "+15149999999",
      primary_phone_tier: "A",
      primary_phone_label: "confirmed",
      primary_phone_is_direct: true,
      alternate_phones: null,
      briefing_text: "Some briefing",
      whats_interesting: null,
      property_matricules: ["MAT-001"],
      audit_url: null,
      research_completed_at: "2026-01-01T00:00:00.000Z",
      published_to_crm: false,
      published_at: null,
    };

    const result = await upsertOwnerRecord(sb, payload);

    expect(fromFn).toHaveBeenCalledWith("owner_record");
    expect(chain.upsert).toHaveBeenCalledWith(payload, { onConflict: "owner_id,snapshot_hash" });
    expect(chain.select).toHaveBeenCalled();
    expect(chain.single).toHaveBeenCalled();
    expect(result.data).toEqual(expected);
    expect(result.error).toBeNull();
  });
});

describe("findCanonicalOwnerById", () => {
  it("calls from('canonical_owner').select('*').eq('owner_id', id).single()", async () => {
    const expected = { owner_id: "owner-4", canonical_name: "John Doe", owner_type: "individual" };
    const capturedTable = { name: "" };
    const { sb, fromFn, chain } = makeSupabaseMock({ data: expected, error: null }, capturedTable);

    const result = await findCanonicalOwnerById(sb, "owner-4");

    expect(fromFn).toHaveBeenCalledWith("canonical_owner");
    expect(chain.select).toHaveBeenCalledWith("*");
    expect(chain.eq).toHaveBeenCalledWith("owner_id", "owner-4");
    expect(chain.single).toHaveBeenCalled();
    expect(result.data).toEqual(expected);
    expect(result.error).toBeNull();
  });
});
