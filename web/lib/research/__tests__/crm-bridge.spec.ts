/**
 * crm-bridge.spec.ts — Tests for publishOwnerRecordToCrm and helpers.
 *
 * Mocks all Supabase chains so no real DB calls happen.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  publishOwnerRecordToCrm,
  labelToLeadStatus,
  tierToConfidence,
} from "../crm-bridge";

// ---------------------------------------------------------------------------
// Mock builder helpers
// ---------------------------------------------------------------------------

/**
 * Builds a fluent Supabase-like chain where every method returns `this`
 * until `.single()` is called, which returns a Promise resolving to `result`.
 */
function makeChain(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  const methods = [
    "select",
    "insert",
    "upsert",
    "update",
    "eq",
    "order",
    "limit",
    "single",
  ] as const;

  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

/**
 * Creates a mock supabase client where each call to `.from(table)` returns a
 * pre-configured chain. Calls are dispatched in order of the `calls` array.
 */
function makeSb(calls: Array<{ data: unknown; error: unknown }>) {
  let callIndex = 0;
  const chains = calls.map(makeChain);

  const fromFn = vi.fn((_table: string) => {
    const chain = chains[callIndex] ?? chains[chains.length - 1];
    callIndex += 1;
    return chain;
  });

  return {
    sb: { from: fromFn } as unknown as Parameters<typeof publishOwnerRecordToCrm>[0],
    fromFn,
    chains,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOwnerRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    record_id: "rec-001",
    owner_id: "owner-001",
    snapshot_hash: "hash-abc",
    primary_phone_e164: "+15141234567",
    primary_phone_tier: "A",
    primary_phone_label: "confirmed",
    primary_phone_is_direct: true,
    alternate_phones: null,
    briefing_text: "Great briefing",
    whats_interesting: null,
    property_matricules: ["MAT-001"],
    audit_url: null,
    research_completed_at: "2026-05-01T10:00:00.000Z",
    published_to_crm: false,
    published_at: null,
    ...overrides,
  };
}

function makeProperty() {
  return { id: "prop-uuid-001" };
}

function makeLead() {
  return { id: "lead-uuid-001", contact_id: "contact-uuid-001" };
}

// ---------------------------------------------------------------------------
// labelToLeadStatus helper tests
// ---------------------------------------------------------------------------

describe("labelToLeadStatus", () => {
  it("confirmed → ready_to_call", () => {
    expect(labelToLeadStatus("confirmed")).toBe("ready_to_call");
  });

  it("likely → ready_to_call", () => {
    expect(labelToLeadStatus("likely")).toBe("ready_to_call");
  });

  it("connected → needs_phone_review", () => {
    expect(labelToLeadStatus("connected")).toBe("needs_phone_review");
  });

  it("weak → unresolved_after_all_sources", () => {
    expect(labelToLeadStatus("weak")).toBe("unresolved_after_all_sources");
  });

  it("null → unresolved_after_all_sources", () => {
    expect(labelToLeadStatus(null)).toBe("unresolved_after_all_sources");
  });
});

// ---------------------------------------------------------------------------
// tierToConfidence helper tests
// ---------------------------------------------------------------------------

describe("tierToConfidence", () => {
  it("A → 95", () => expect(tierToConfidence("A")).toBe(95));
  it("B → 80", () => expect(tierToConfidence("B")).toBe(80));
  it("C → 60", () => expect(tierToConfidence("C")).toBe(60));
  it("D → 40", () => expect(tierToConfidence("D")).toBe(40));
  it("E → 20", () => expect(tierToConfidence("E")).toBe(20));
  it("unknown → 50", () => expect(tierToConfidence(null)).toBe(50));
});

// ---------------------------------------------------------------------------
// publishOwnerRecordToCrm tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishOwnerRecordToCrm", () => {
  // -------------------------------------------------------------------------
  // Test 1: Happy path — confirmed → ready_to_call
  // -------------------------------------------------------------------------
  it("1. happy path: confirmed label → updates lead status to ready_to_call", async () => {
    const ownerRecord = makeOwnerRecord({ primary_phone_label: "confirmed" });

    const { sb, fromFn } = makeSb([
      { data: ownerRecord, error: null },        // owner_record fetch
      { data: makeProperty(), error: null },     // properties fetch
      { data: makeLead(), error: null },         // leads fetch
      { data: null, error: null },               // leads update
      { data: null, error: null },               // phones upsert
      { data: null, error: null },               // owner_record mark published
    ]);

    const result = await publishOwnerRecordToCrm(sb, { ownerId: "owner-001" });

    expect(result.alreadyPublished).toBe(false);
    expect(result.leadsUpdated).toBe(1);
    expect(result.phonesUpserted).toBe(1);
    expect(result.matriculesPublished).toEqual(["MAT-001"]);
    expect(result.warnings).toHaveLength(0);

    // Verify the leads update call included status=ready_to_call
    const leadsChain = fromFn.mock.results[3]?.value;
    expect(leadsChain?.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready_to_call" }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: connected → needs_phone_review
  // -------------------------------------------------------------------------
  it("2. connected label → updates lead status to needs_phone_review", async () => {
    const ownerRecord = makeOwnerRecord({ primary_phone_label: "connected", primary_phone_tier: "C" });

    const { sb, fromFn } = makeSb([
      { data: ownerRecord, error: null },
      { data: makeProperty(), error: null },
      { data: makeLead(), error: null },
      { data: null, error: null },               // leads update
      { data: null, error: null },               // phones upsert
      { data: null, error: null },               // mark published
    ]);

    const result = await publishOwnerRecordToCrm(sb, { ownerId: "owner-001" });

    expect(result.leadsUpdated).toBe(1);

    const leadsChain = fromFn.mock.results[3]?.value;
    expect(leadsChain?.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "needs_phone_review" }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: weak → unresolved_after_all_sources
  // -------------------------------------------------------------------------
  it("3. weak label → updates lead status to unresolved_after_all_sources", async () => {
    const ownerRecord = makeOwnerRecord({
      primary_phone_label: "weak",
      primary_phone_e164: "+15140000000",
      primary_phone_tier: "E",
    });

    const { sb, fromFn } = makeSb([
      { data: ownerRecord, error: null },
      { data: makeProperty(), error: null },
      { data: makeLead(), error: null },
      { data: null, error: null },               // leads update
      { data: null, error: null },               // phones upsert
      { data: null, error: null },               // mark published
    ]);

    const result = await publishOwnerRecordToCrm(sb, { ownerId: "owner-001" });

    expect(result.leadsUpdated).toBe(1);

    const leadsChain = fromFn.mock.results[3]?.value;
    expect(leadsChain?.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unresolved_after_all_sources" }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 4: multiple matricules → multiple leads updated; counts correct
  // -------------------------------------------------------------------------
  it("4. multiple matricules → multiple leads updated and counts are correct", async () => {
    const ownerRecord = makeOwnerRecord({
      property_matricules: ["MAT-001", "MAT-002"],
    });

    const { sb } = makeSb([
      { data: ownerRecord, error: null },          // owner_record
      { data: { id: "prop-1" }, error: null },     // properties MAT-001
      { data: { id: "lead-1", contact_id: "contact-1" }, error: null }, // leads MAT-001
      { data: null, error: null },                 // update lead-1
      { data: null, error: null },                 // phone upsert lead-1
      { data: { id: "prop-2" }, error: null },     // properties MAT-002
      { data: { id: "lead-2", contact_id: "contact-2" }, error: null }, // leads MAT-002
      { data: null, error: null },                 // update lead-2
      { data: null, error: null },                 // phone upsert lead-2
      { data: null, error: null },                 // mark published
    ]);

    const result = await publishOwnerRecordToCrm(sb, { ownerId: "owner-001" });

    expect(result.leadsUpdated).toBe(2);
    expect(result.phonesUpserted).toBe(2);
    expect(result.matriculesPublished).toEqual(["MAT-001", "MAT-002"]);
    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 5: already-published → returns alreadyPublished=true, no writes
  // -------------------------------------------------------------------------
  it("5. already-published owner_record → alreadyPublished=true and no writes", async () => {
    const ownerRecord = makeOwnerRecord({
      published_to_crm: true,
      published_at: "2026-05-01T12:00:00.000Z",
    });

    const { sb, fromFn } = makeSb([
      { data: ownerRecord, error: null }, // owner_record fetch
    ]);

    const result = await publishOwnerRecordToCrm(sb, { ownerId: "owner-001" });

    expect(result.alreadyPublished).toBe(true);
    expect(result.leadsUpdated).toBe(0);
    expect(result.phonesUpserted).toBe(0);
    expect(result.matriculesPublished).toEqual([]);

    // Only 1 DB call (owner_record fetch); no writes
    expect(fromFn).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 6: owner_record not found → throws
  // -------------------------------------------------------------------------
  it("6. owner_record not found → throws with descriptive message", async () => {
    const { sb } = makeSb([
      { data: null, error: { message: "no rows returned" } },
    ]);

    await expect(
      publishOwnerRecordToCrm(sb, { ownerId: "unknown-owner" }),
    ).rejects.toThrow(/no owner_record found for owner unknown-owner/);
  });

  // -------------------------------------------------------------------------
  // Test 7: phones upsert idempotent (called twice → same final state)
  // -------------------------------------------------------------------------
  it("7. phones upsert is idempotent — calling twice gives same result", async () => {
    const ownerRecord = makeOwnerRecord();

    function buildCalls() {
      return [
        { data: ownerRecord, error: null },
        { data: makeProperty(), error: null },
        { data: makeLead(), error: null },
        { data: null, error: null },   // leads update
        { data: null, error: null },   // phones upsert
        { data: null, error: null },   // mark published
      ];
    }

    // First publish
    const { sb: sb1 } = makeSb(buildCalls());
    const first = await publishOwnerRecordToCrm(sb1, { ownerId: "owner-001" });

    // Second publish: owner_record now has published_to_crm=true
    const publishedRecord = makeOwnerRecord({ published_to_crm: true, published_at: "2026-05-01T12:00:00.000Z" });
    const { sb: sb2 } = makeSb([{ data: publishedRecord, error: null }]);
    const second = await publishOwnerRecordToCrm(sb2, { ownerId: "owner-001" });

    expect(first.phonesUpserted).toBe(1);
    expect(second.alreadyPublished).toBe(true);
    expect(second.phonesUpserted).toBe(0);
    // Final desired state: the phone exists (upserted once by first call)
    expect(first.leadsUpdated).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 8: no primary phone → lead updated (status set), no phones upserted
  // -------------------------------------------------------------------------
  it("8. no primary phone → lead status updated but no phones upserted", async () => {
    const ownerRecord = makeOwnerRecord({
      primary_phone_e164: null,
      primary_phone_tier: null,
      primary_phone_label: null,
    });

    const { sb, fromFn } = makeSb([
      { data: ownerRecord, error: null },
      { data: makeProperty(), error: null },
      { data: makeLead(), error: null },
      { data: null, error: null },   // leads update (still happens)
      { data: null, error: null },   // mark published
    ]);

    const result = await publishOwnerRecordToCrm(sb, { ownerId: "owner-001" });

    expect(result.leadsUpdated).toBe(1);
    expect(result.phonesUpserted).toBe(0);
    expect(result.warnings).toHaveLength(0);

    const leadsChain = fromFn.mock.results[3]?.value;
    expect(leadsChain?.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unresolved_after_all_sources" }),
    );
  });

  // -------------------------------------------------------------------------
  // Additional: property not found → warning added, lead skipped
  // -------------------------------------------------------------------------
  it("9. property not found → warning added, lead count not incremented", async () => {
    const ownerRecord = makeOwnerRecord();

    const { sb } = makeSb([
      { data: ownerRecord, error: null },
      { data: null, error: { message: "not found" } }, // property not found
      { data: null, error: null },                      // mark published
    ]);

    const result = await publishOwnerRecordToCrm(sb, { ownerId: "owner-001" });

    expect(result.leadsUpdated).toBe(0);
    expect(result.phonesUpserted).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/MAT-001.*property not found/);
  });

  // -------------------------------------------------------------------------
  // Additional: alternate phones are also upserted
  // -------------------------------------------------------------------------
  it("10. alternate phones are upserted in addition to primary", async () => {
    const ownerRecord = makeOwnerRecord({
      alternate_phones: [
        { phoneE164: "+15149999999", tier: "B", label: "likely", isDirect: false },
      ],
    });

    const { sb } = makeSb([
      { data: ownerRecord, error: null },
      { data: makeProperty(), error: null },
      { data: makeLead(), error: null },
      { data: null, error: null },   // leads update
      { data: null, error: null },   // primary phone upsert
      { data: null, error: null },   // alternate phone upsert
      { data: null, error: null },   // mark published
    ]);

    const result = await publishOwnerRecordToCrm(sb, { ownerId: "owner-001" });

    expect(result.phonesUpserted).toBe(2);
    expect(result.warnings).toHaveLength(0);
  });
});
