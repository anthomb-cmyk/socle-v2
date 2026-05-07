/**
 * record-assembler.spec.ts — Tests for assembleOwnerRecord and computeSnapshotHash.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module so we never hit a real Supabase instance
vi.mock("../db", () => ({
  upsertOwnerRecord: vi.fn(),
}));

import { computeSnapshotHash, assembleOwnerRecord } from "../record-assembler";
import type { AssembleInput } from "../record-assembler";
import * as db from "../db";

const mockUpsert = db.upsertOwnerRecord as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    ownerId: "owner-001",
    primaryHypothesis: {
      phoneE164: "+15141234567",
      tier: "A",
      label: "confirmed",
      isDirect: true,
    },
    briefingText: "Test briefing",
    propertyMatricules: ["9940-12-3456-7-001", "9940-12-9999-0-001"],
    ...overrides,
  };
}

function makeRecord(recordId: string, researchCompletedAt: string) {
  return {
    record_id: recordId,
    owner_id: "owner-001",
    snapshot_hash: "abc",
    primary_phone_e164: "+15141234567",
    primary_phone_tier: "A",
    primary_phone_label: "confirmed",
    primary_phone_is_direct: true,
    alternate_phones: null,
    briefing_text: "Test briefing",
    whats_interesting: null,
    property_matricules: ["9940-12-3456-7-001", "9940-12-9999-0-001"],
    audit_url: null,
    research_completed_at: researchCompletedAt,
    published_to_crm: false,
    published_at: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeSnapshotHash", () => {
  it("1. produces the same hash for the same input (deterministic)", () => {
    const input = baseInput();
    expect(computeSnapshotHash(input)).toBe(computeSnapshotHash(input));
  });

  it("2. property matricule order does not affect the hash", () => {
    const a = computeSnapshotHash(
      baseInput({ propertyMatricules: ["aaa", "bbb", "ccc"] }),
    );
    const b = computeSnapshotHash(
      baseInput({ propertyMatricules: ["ccc", "aaa", "bbb"] }),
    );
    expect(a).toBe(b);
  });

  it("3. changing primaryHypothesis.phoneE164 changes the hash", () => {
    const a = computeSnapshotHash(
      baseInput({ primaryHypothesis: { phoneE164: "+15141111111", tier: "A", label: "confirmed", isDirect: true } }),
    );
    const b = computeSnapshotHash(
      baseInput({ primaryHypothesis: { phoneE164: "+15142222222", tier: "A", label: "confirmed", isDirect: true } }),
    );
    expect(a).not.toBe(b);
  });

  it("4. changing briefingText changes the hash", () => {
    const a = computeSnapshotHash(baseInput({ briefingText: "old briefing" }));
    const b = computeSnapshotHash(baseInput({ briefingText: "new briefing" }));
    expect(a).not.toBe(b);
  });

  it("5. adding a property matricule changes the hash", () => {
    const a = computeSnapshotHash(baseInput({ propertyMatricules: ["mat-1"] }));
    const b = computeSnapshotHash(baseInput({ propertyMatricules: ["mat-1", "mat-2"] }));
    expect(a).not.toBe(b);
  });
});

describe("assembleOwnerRecord", () => {
  function makeSb() {
    return {} as Parameters<typeof assembleOwnerRecord>[0];
  }

  it("6. isNew=true when upsert returns a fresh row (timestamps match)", async () => {
    // We cannot control the timestamp inside assembleOwnerRecord directly,
    // but we can simulate it by having upsertOwnerRecord return a row whose
    // research_completed_at matches what was sent.
    mockUpsert.mockImplementation(async (_sb: unknown, r: Record<string, unknown>) => ({
      data: makeRecord("rec-001", r.research_completed_at as string),
      error: null,
    }));

    const result = await assembleOwnerRecord(makeSb(), baseInput());
    expect(result.isNew).toBe(true);
    expect(result.recordId).toBe("rec-001");
    expect(result.snapshotHash).toHaveLength(64); // sha256 hex
  });

  it("7. isNew=false when upsert returns a row with a different timestamp (no-op conflict)", async () => {
    const oldTimestamp = "2025-01-01T00:00:00.000Z";
    mockUpsert.mockResolvedValue({
      data: makeRecord("rec-002", oldTimestamp),
      error: null,
    });

    const result = await assembleOwnerRecord(makeSb(), baseInput());
    // The returned timestamp differs from what we sent → existing row
    expect(result.isNew).toBe(false);
    expect(result.recordId).toBe("rec-002");
  });

  it("8. handles missing optional fields gracefully", async () => {
    const minimalInput: AssembleInput = { ownerId: "owner-minimal" };
    mockUpsert.mockImplementation(async (_sb: unknown, r: Record<string, unknown>) => ({
      data: {
        record_id: "rec-minimal",
        owner_id: "owner-minimal",
        snapshot_hash: "xyz",
        primary_phone_e164: null,
        primary_phone_tier: null,
        primary_phone_label: null,
        primary_phone_is_direct: null,
        alternate_phones: null,
        briefing_text: null,
        whats_interesting: null,
        property_matricules: null,
        audit_url: null,
        research_completed_at: r.research_completed_at,
        published_to_crm: false,
        published_at: null,
      },
      error: null,
    }));

    const result = await assembleOwnerRecord(makeSb(), minimalInput);
    expect(result.recordId).toBe("rec-minimal");
    expect(result.snapshotHash).toBeTruthy();

    // Verify the call passed nulls for missing fields
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        primary_phone_e164: null,
        primary_phone_tier: null,
        briefing_text: null,
        alternate_phones: null,
        property_matricules: null,
      }),
    );
  });

  it("9. throws when upsertOwnerRecord returns an error", async () => {
    mockUpsert.mockResolvedValue({ data: null, error: { message: "DB error" } });

    await expect(assembleOwnerRecord(makeSb(), baseInput())).rejects.toThrow(
      /upsert failed/,
    );
  });

  it("10. snapshotHash is included in the upsert payload", async () => {
    mockUpsert.mockImplementation(async (_sb: unknown, r: Record<string, unknown>) => ({
      data: makeRecord("rec-hash", r.research_completed_at as string),
      error: null,
    }));

    const input = baseInput();
    const expectedHash = computeSnapshotHash(input);
    const result = await assembleOwnerRecord(makeSb(), input);

    expect(result.snapshotHash).toBe(expectedHash);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ snapshot_hash: expectedHash }),
    );
  });
});
