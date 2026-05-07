/**
 * cross-property.spec.ts — Tests for the cross-property researcher.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../db", () => ({
  insertEvidence: vi.fn().mockResolvedValue({
    data: { evidence_id: "ev-cp-001" },
    error: null,
  }),
}));

import { crossPropertyResearcher } from "../cross-property";
import * as db from "../../db";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockInsertEvidence = db.insertEvidence as ReturnType<typeof vi.fn>;

function makeOwner() {
  return {
    owner_id: "owner-cp-001",
    owner_type: "individual" as const,
    canonical_name: "Pierre Lavoie",
    canonical_name_normalized: "pierre lavoie",
    neq: null,
    mailing_address_raw: "789 Rue Ontario E, Montréal, QC H2L 1N7",
    mailing_geocode: null,
    mailing_postal_fsa: "H2L",
    dedupe_status: "pending_review" as const,
    is_aggregator_address: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

/**
 * Build a Supabase mock where each table resolves to the given rows.
 * All chained methods return `this` so the object is awaitable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSb(tableRows: Record<string, Record<string, unknown>[]>): any {
  return {
    from: vi.fn((table: string) => {
      const rows = tableRows[table] ?? [];
      const result = { data: rows, error: null };
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
        // Make the whole chain awaitable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then(onFulfilled: any, onRejected: any) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return chain;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-cp-001" }, error: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("crossPropertyResearcher", () => {
  it("returns empty array when no sibling owners and no CRM contacts found", async () => {
    const sb = makeSb({
      canonical_owner: [],
      owner_alias: [],
      owner_record: [],
      contacts: [],
      phones: [],
    });

    const candidates = await crossPropertyResearcher(sb, makeOwner());

    expect(candidates).toHaveLength(0);
    expect(mockInsertEvidence).not.toHaveBeenCalled();
  });

  it("returns candidates from sibling owner_record matches", async () => {
    const sb = makeSb({
      canonical_owner: [{ owner_id: "sibling-001" }],
      owner_alias: [],
      owner_record: [{ owner_id: "sibling-001", primary_phone_e164: "+15149876543" }],
      contacts: [],
      phones: [],
    });

    const candidates = await crossPropertyResearcher(sb, makeOwner());

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0].phone).toBe("+15149876543");
    expect(candidates[0].source).toBe("cross_property");
    expect(candidates[0].isAuthoritative).toBe(false);
    expect(mockInsertEvidence).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({
        source: "cross_property",
        owner_id: "owner-cp-001",
      }),
    );
  });

  it("returns candidates from CRM phones via contact name match", async () => {
    const sb = makeSb({
      canonical_owner: [],
      owner_alias: [],
      owner_record: [],
      contacts: [{ id: "contact-999" }],
      phones: [{ e164: "+15141112233", contact_id: "contact-999" }],
    });

    const candidates = await crossPropertyResearcher(sb, makeOwner());

    expect(candidates.some((c) => c.phone === "+15141112233")).toBe(true);
    expect(candidates[0].source).toBe("cross_property");
  });

  it("deduplicates phones that appear in both canonical_owner and CRM lookups", async () => {
    const SHARED_PHONE = "+15145556677";
    const sb = makeSb({
      canonical_owner: [{ owner_id: "sibling-002" }],
      owner_alias: [],
      owner_record: [{ owner_id: "sibling-002", primary_phone_e164: SHARED_PHONE }],
      contacts: [{ id: "contact-crm-1" }],
      phones: [{ e164: SHARED_PHONE, contact_id: "contact-crm-1" }],
    });

    const candidates = await crossPropertyResearcher(sb, makeOwner());

    const phones = candidates.map((c) => c.phone);
    const uniquePhones = new Set(phones);
    // No duplicates
    expect(uniquePhones.size).toBe(phones.length);
    expect(uniquePhones.has(SHARED_PHONE)).toBe(true);
  });

  it("handles DB errors gracefully and returns partial results", async () => {
    // canonical_owner throws, but contacts works
    const sb = {
      from: vi.fn((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then(onFulfilled: any, onRejected: any) {
            if (table === "canonical_owner") {
              return Promise.reject(new Error("DB error")).then(onFulfilled, onRejected);
            }
            if (table === "contacts") {
              return Promise.resolve({ data: [{ id: "contact-fallback" }], error: null }).then(onFulfilled, onRejected);
            }
            if (table === "phones") {
              return Promise.resolve({
                data: [{ e164: "+15143334455", contact_id: "contact-fallback" }],
                error: null,
              }).then(onFulfilled, onRejected);
            }
            return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
          },
        };
        return chain;
      }),
    };

    // Should NOT throw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = await crossPropertyResearcher(sb as any, makeOwner());

    // CRM path should still have returned its result
    expect(candidates.some((c) => c.phone === "+15143334455")).toBe(true);
  });
});
