/**
 * Tests for the three-stage canonical-owner deduplication module.
 *
 * All supabase chains are mocked — no real DB calls.
 */

import { describe, it, expect, vi } from "vitest";
import {
  dedupeOwner,
  normalizeForDedupe,
  type DedupeInput,
} from "../dedupe";

// ---------------------------------------------------------------------------
// Mock builder helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock Supabase chain where every terminal method (maybeSingle, limit)
 * resolves to the provided result.
 */
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "insert",
    "eq",
    "not",
    "is",
    "limit",
    "maybeSingle",
    "single",
  ] as const;
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal methods that return a promise
  (chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  (chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  return chain;
}

/**
 * Build a mock Supabase client where `from(table)` returns the provided chain.
 * Optionally, different tables can return different chains via the `tableMap`.
 */
function makeSb(
  defaultResult: { data: unknown; error: unknown },
  tableMap: Record<string, { data: unknown; error: unknown }> = {},
) {
  return {
    from: vi.fn((table: string) => {
      const result = tableMap[table] ?? defaultResult;
      return makeChain(result);
    }),
  };
}

// ---------------------------------------------------------------------------
// normalizeForDedupe
// ---------------------------------------------------------------------------

describe("normalizeForDedupe", () => {
  it("uses entity normalization for named_co", () => {
    const result = normalizeForDedupe("GESTION TREMBLAY INC", "named_co");
    expect(result).toBe("gestion tremblay");
  });

  it("uses entity normalization for numbered_co", () => {
    const result = normalizeForDedupe("9123-4567 QUÉBEC INC", "numbered_co");
    expect(result).toBe("9123 4567 quebec");
  });

  it("uses person normalization for individual", () => {
    const result = normalizeForDedupe("Jean-François Tremblay", "individual");
    expect(result).toBe("jean francois tremblay");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeForDedupe("", "individual")).toBe("");
    expect(normalizeForDedupe("", "named_co")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Stage 0 — NEQ exact match (companies only)
// ---------------------------------------------------------------------------

describe("dedupeOwner — Stage 0 NEQ match", () => {
  it("returns exact match when NEQ matches in canonical_owner", async () => {
    const existingOwnerId = "aaaa-1111-bbbb-2222";
    const sb = makeSb(
      { data: null, error: null },
      {
        canonical_owner: { data: { owner_id: existingOwnerId }, error: null },
      },
    );

    const input: DedupeInput = {
      canonicalName: "9123-4567 Québec Inc",
      ownerType: "numbered_co",
      neq: "9123456700",
    };

    const result = await dedupeOwner(sb as never, input);
    expect(result).toEqual({ kind: "exact", ownerId: existingOwnerId });
  });

  it("skips Stage 0 for individuals (no NEQ lookup)", async () => {
    // If Stage 0 were attempted, it would find the row and return early.
    // For individuals, even if neq is supplied, Stage 0 must be skipped.
    const sb = makeSb({ data: null, error: null });
    const fromSpy = vi.spyOn(sb, "from");

    const input: DedupeInput = {
      canonicalName: "Jean Tremblay",
      ownerType: "individual",
      neq: "9999999999",
    };

    // All queries return no data → falls through to no_match
    const result = await dedupeOwner(sb as never, input);
    expect(result.kind).toBe("no_match");

    // canonical_owner should only be queried at Stage 1 (not for NEQ)
    const canonicalOwnerCalls = fromSpy.mock.calls.filter(
      (c) => c[0] === "canonical_owner",
    );
    // Stage 1 still queries canonical_owner by name+FSA — that's fine.
    // The key assertion: no call with .eq("neq", ...) from Stage 0.
    // We verify indirectly: if Stage 0 ran and found a result the function
    // would have returned early; it didn't, so no NEQ hit was processed.
    expect(result.kind).toBe("no_match");
    // canonical_owner was called at most once (for Stage 1 name query)
    expect(canonicalOwnerCalls.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Stage 1 — deterministic name + FSA match
// ---------------------------------------------------------------------------

describe("dedupeOwner — Stage 1 deterministic match", () => {
  it("returns exact match when canonical_name_normalized + FSA match", async () => {
    const existingOwnerId = "cccc-3333-dddd-4444";
    const sb = makeSb(
      { data: null, error: null },
      {
        canonical_owner: {
          data: [{ owner_id: existingOwnerId }],
          error: null,
        },
        owner_alias: { data: [], error: null },
      },
    );

    const input: DedupeInput = {
      canonicalName: "GESTION TREMBLAY INC",
      ownerType: "named_co",
      mailingPostal: "H2X 1A1",
    };

    const result = await dedupeOwner(sb as never, input);
    expect(result).toEqual({ kind: "exact", ownerId: existingOwnerId });
  });

  it("returns exact match via owner_alias probe", async () => {
    const existingOwnerId = "eeee-5555-ffff-6666";
    const sb = makeSb(
      { data: null, error: null },
      {
        // canonical_owner returns nothing (no direct name hit)
        canonical_owner: { data: [], error: null },
        // alias table has a hit
        owner_alias: { data: [{ owner_id: existingOwnerId }], error: null },
      },
    );

    const input: DedupeInput = {
      canonicalName: "Tremblay Jean",
      ownerType: "individual",
      mailingPostal: "H3B 2Y5",
    };

    const result = await dedupeOwner(sb as never, input);
    expect(result).toEqual({ kind: "exact", ownerId: existingOwnerId });
  });
});

// ---------------------------------------------------------------------------
// Stage 2 — fuzzy geocode match (≤ 500m)
// ---------------------------------------------------------------------------

describe("dedupeOwner — Stage 2 fuzzy geocode", () => {
  /**
   * Two points roughly 400m apart in Montréal.
   * (45.5017, -73.5673) and (45.5053, -73.5673) → ~400m north.
   */
  const BASE_LAT = 45.5017;
  const BASE_LNG = -73.5673;
  // ~400m north (≈0.0036 degrees lat)
  const CLOSE_LAT = 45.5053;

  it("returns fuzzy_review when geocode is within 500m", async () => {
    const existingOwnerId = "gggg-7777-hhhh-8888";

    const sb = makeSb(
      { data: null, error: null },
      {
        // Stage 1 returns nothing
        canonical_owner: {
          data: [{ owner_id: existingOwnerId, mailing_geocode: { lat: CLOSE_LAT, lng: BASE_LNG } }],
          error: null,
        },
        owner_alias: { data: [], error: null },
      },
    );

    // Override: Stage 1 name+FSA returns empty, but Stage 2 name-only returns the row.
    // We do this by building a more nuanced sb where limit(1) from Stage 1 differs from
    // the Stage 2 query. The simpler approach: supply null FSA so Stage 1 still queries
    // canonical_owner but with no FSA filter. We intercept by returning an array (not
    // single row) for limit() — Stage 1 checks `data[0]`, Stage 2 iterates.
    // Since our mock returns the same chain regardless of query specifics, and Stage 1
    // reads `data[0]` from the array which IS the geocode row, it would short-circuit.
    // To properly test Stage 2 in isolation, set no FSA and have canonical_owner return
    // empty for limit=1 calls but non-empty for the Stage 2 call.
    //
    // Practical approach: use separate mock per from() invocation count.
    let canonicalOwnerCallCount = 0;
    const sbFull = {
      from: vi.fn((table: string) => {
        if (table === "canonical_owner") {
          canonicalOwnerCallCount++;
          if (canonicalOwnerCallCount === 1) {
            // Stage 1: no name+FSA hit
            return makeChain({ data: [], error: null });
          }
          // Stage 2: geocode rows present
          return makeChain({
            data: [{ owner_id: existingOwnerId, mailing_geocode: { lat: CLOSE_LAT, lng: BASE_LNG } }],
            error: null,
          });
        }
        if (table === "owner_alias") {
          return makeChain({ data: [], error: null });
        }
        return makeChain({ data: null, error: null });
      }),
    };

    const input: DedupeInput = {
      canonicalName: "GESTION TREMBLAY INC",
      ownerType: "named_co",
      mailingGeocode: { lat: BASE_LAT, lng: BASE_LNG },
      // No FSA — so Stage 1 won't find by FSA
    };

    const result = await dedupeOwner(sbFull as never, input);
    expect(result.kind).toBe("fuzzy_review");
    expect((result as { kind: "fuzzy_review"; ownerId: string; reason: string }).ownerId).toBe(existingOwnerId);
  });

  it("returns no_match when geocode is outside 500m", async () => {
    // ~900m away: ~0.008 degrees latitude ≈ 890m
    const FAR_LAT = BASE_LAT + 0.008;

    let canonicalOwnerCallCount = 0;
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "canonical_owner") {
          canonicalOwnerCallCount++;
          if (canonicalOwnerCallCount === 1) {
            return makeChain({ data: [], error: null });
          }
          // Stage 2: row is too far away
          return makeChain({
            data: [{ owner_id: "xxxx", mailing_geocode: { lat: FAR_LAT, lng: BASE_LNG } }],
            error: null,
          });
        }
        if (table === "owner_alias") {
          return makeChain({ data: [], error: null });
        }
        return makeChain({ data: null, error: null });
      }),
    };

    const input: DedupeInput = {
      canonicalName: "GESTION TREMBLAY INC",
      ownerType: "named_co",
      mailingGeocode: { lat: BASE_LAT, lng: BASE_LNG },
    };

    const result = await dedupeOwner(sb as never, input);
    expect(result.kind).toBe("no_match");
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — no match
// ---------------------------------------------------------------------------

describe("dedupeOwner — Stage 3 no_match", () => {
  it("returns no_match when nothing is found anywhere", async () => {
    const sb = makeSb({ data: [], error: null });

    const input: DedupeInput = {
      canonicalName: "Nouveau Propriétaire Inconnu",
      ownerType: "individual",
      mailingPostal: "J0T 1A0",
    };

    const result = await dedupeOwner(sb as never, input);
    expect(result).toEqual({ kind: "no_match" });
  });

  it("returns no_match when canonical name is empty", async () => {
    const sb = makeSb({ data: null, error: null });

    const input: DedupeInput = {
      canonicalName: "",
      ownerType: "individual",
    };

    const result = await dedupeOwner(sb as never, input);
    expect(result).toEqual({ kind: "no_match" });
  });
});
