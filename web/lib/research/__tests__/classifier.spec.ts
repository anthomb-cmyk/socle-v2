/**
 * Unit tests for the routing classifier.
 *
 * All DB / lookup calls are mocked — no real Supabase connection required.
 *
 * Test matrix:
 *   1.  Numbered company with NEQ → Pipeline A, primaryTarget set.
 *   2.  Named company without NEQ, name match → Pipeline A.
 *   3.  Named company name match returns 4 entities → primary + 3 candidates.
 *   4.  Individual, geocode hits 1 entity, owner is director → Pipeline A + reqEnrichment.
 *   5.  Individual, geocode hits 1 entity but no director/name link → Pipeline B.
 *   6.  Individual, geocode hits 11 entities → Pipeline B + isAggregator.
 *   7.  Individual, no geocode but is director of 2 entities → Pipeline B + reqEnrichment.
 *   8.  Individual, no geocode, not a director → Pipeline B no enrichment.
 *   9.  Owner not found → throws.
 *  10.  Geocode RPC throws → Pipeline B fallback (graceful degradation).
 *  11.  Individual, no geocode on owner, has mailing_address_raw → lazy geocode called.
 *  12.  Individual, lazy geocode returns null → falls through to director result.
 *  13.  Individual, name-first: director match found even when geocode is absent.
 *  14.  Individual, geocode hits 2–10 entities, is a director → Pipeline B + reqEnrichment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RoutingDecision } from "../classifier";
import type { ReqEntity } from "../../req/types";

// ---------------------------------------------------------------------------
// Module mocks (must be hoisted before the import of the unit under test)
// ---------------------------------------------------------------------------

vi.mock("../../req/lookup", () => ({
  findEntitiesByGeocode: vi.fn(),
  findEntitiesByName: vi.fn(),
  findEntitiesByDirector: vi.fn(),
}));

vi.mock("../db", () => ({
  findCanonicalOwnerById: vi.fn(),
}));

vi.mock("../../req/geocode", () => ({
  getOrFetchGeocode: vi.fn(),
  getOrFetchEntityGeocode: vi.fn(),
}));

// Import after mocks are registered
import { routeOwner } from "../classifier";
import * as lookup from "../../req/lookup";
import * as db from "../db";
import * as geocodeModule from "../../req/geocode";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeEntity = (neq: string, legalNameNormalized: string): ReqEntity => ({
  neq,
  legal_name: legalNameNormalized,
  legal_name_normalized: legalNameNormalized,
  juridical_form: null,
  status: "ACTIF",
  status_date: null,
  registered_address_raw: null,
  mailing_address_raw: null,
  registered_geocode: null,
  mailing_geocode: null,
  postal_fsa: null,
  registered_phone: null,
  activity_codes: null,
  imported_at: "2025-01-01T00:00:00Z",
});

const ENTITY_A = makeEntity("9000000001", "gestion tremblay");
const ENTITY_B = makeEntity("9000000002", "immeubles laval");
const ENTITY_C = makeEntity("9000000003", "constructions nord");
const ENTITY_D = makeEntity("9000000004", "placements sud");

// Canonical owner factories
function makeCompanyOwner(overrides: Partial<{
  owner_id: string;
  owner_type: string;
  canonical_name: string;
  canonical_name_normalized: string;
  neq: string | null;
  mailing_geocode: unknown;
}> = {}) {
  return {
    owner_id: "owner-co-1",
    owner_type: "named_co",
    canonical_name: "Gestion Tremblay Inc",
    canonical_name_normalized: "gestion tremblay",
    neq: null,
    mailing_address_raw: null,
    mailing_geocode: null,
    mailing_postal_fsa: null,
    dedupe_status: "pending_review",
    is_aggregator_address: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeIndividualOwner(overrides: Partial<{
  owner_id: string;
  canonical_name: string;
  canonical_name_normalized: string;
  mailing_geocode: unknown;
}> = {}) {
  return {
    owner_id: "owner-ind-1",
    owner_type: "individual",
    canonical_name: "Jean Tremblay",
    canonical_name_normalized: "jean tremblay",
    neq: null,
    mailing_address_raw: null,
    mailing_geocode: null,
    mailing_postal_fsa: null,
    dedupe_status: "pending_review",
    is_aggregator_address: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// GeoJSON geocode fixture (PostGIS returns coordinates as [lng, lat])
const GEOCODE_POINT = { coordinates: [-73.6, 45.5] };

// Minimal Supabase builder for the NEQ direct lookup in company path
function makeNeqBuilder(entity: ReqEntity | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: entity ? [entity] : [], error: null }).then(resolve);
  return chain;
}

function makeSupabaseMock(entityForNeq: ReqEntity | null = null) {
  const builder = makeNeqBuilder(entityForNeq);
  return {
    from: vi.fn(() => builder),
    _builder: builder,
  } as unknown as Parameters<typeof routeOwner>[0];
}

// ---------------------------------------------------------------------------
// Helper to cast mocks
// ---------------------------------------------------------------------------
const mockFindCanonicalOwnerById = db.findCanonicalOwnerById as ReturnType<typeof vi.fn>;
const mockFindEntitiesByGeocode = lookup.findEntitiesByGeocode as ReturnType<typeof vi.fn>;
const mockFindEntitiesByName = lookup.findEntitiesByName as ReturnType<typeof vi.fn>;
const mockFindEntitiesByDirector = lookup.findEntitiesByDirector as ReturnType<typeof vi.fn>;
const mockGetOrFetchGeocode = geocodeModule.getOrFetchGeocode as ReturnType<typeof vi.fn>;
const mockGetOrFetchEntityGeocode = geocodeModule.getOrFetchEntityGeocode as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: geocode returns empty, name returns empty, director returns empty
  mockFindEntitiesByGeocode.mockResolvedValue([]);
  mockFindEntitiesByName.mockResolvedValue([]);
  mockFindEntitiesByDirector.mockResolvedValue([]);
  // Default: lazy geocode helpers return null (no API key in test env)
  mockGetOrFetchGeocode.mockResolvedValue(null);
  mockGetOrFetchEntityGeocode.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("routeOwner — company owners", () => {
  it("1. numbered company with NEQ → Pipeline A with primaryTarget", async () => {
    const owner = makeCompanyOwner({ owner_type: "numbered_co", neq: "9000000001" });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    const sb = makeSupabaseMock(ENTITY_A);

    const result: RoutingDecision = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("A");
    expect(result.primaryTarget?.neq).toBe("9000000001");
    expect(result.isAggregator).toBe(false);
    expect(result.reason).toBe("company owner");
  });

  it("2. named company without NEQ, single name match → Pipeline A", async () => {
    const owner = makeCompanyOwner({ neq: null });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByName.mockResolvedValue([ENTITY_A]);
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("A");
    expect(result.primaryTarget?.neq).toBe(ENTITY_A.neq);
    expect(result.candidateTargets).toBeUndefined();
    expect(result.isAggregator).toBe(false);
  });

  it("3. named company name match returns 4 entities → primary + 3 candidates", async () => {
    const owner = makeCompanyOwner({ neq: null });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByName.mockResolvedValue([ENTITY_A, ENTITY_B, ENTITY_C, ENTITY_D]);
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("A");
    expect(result.primaryTarget?.neq).toBe(ENTITY_A.neq);
    expect(result.candidateTargets).toHaveLength(3);
    expect(result.candidateTargets?.map((e) => e.neq)).toEqual([
      ENTITY_B.neq,
      ENTITY_C.neq,
      ENTITY_D.neq,
    ]);
  });
});

describe("routeOwner — individual owners", () => {
  it("4. geocode hits 1 entity, owner is director → Pipeline A with primaryTarget + reqEnrichment", async () => {
    const owner = makeIndividualOwner({ mailing_geocode: GEOCODE_POINT });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByGeocode.mockResolvedValue([ENTITY_A]);
    // Director of ENTITY_A → isDirector = true
    mockFindEntitiesByDirector.mockResolvedValue([{ entity: ENTITY_A, director: {} }]);
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("A");
    expect(result.primaryTarget?.neq).toBe(ENTITY_A.neq);
    expect(result.reqEnrichment?.isDirector).toBe(true);
    expect(result.reqEnrichment?.directorOf).toHaveLength(1);
    expect(result.reqEnrichment?.directorOf[0].neq).toBe(ENTITY_A.neq);
    expect(result.isAggregator).toBe(false);
  });

  it("5. geocode hits 1 entity but no director/name link → Pipeline B", async () => {
    // Entity whose name shares no token with "jean tremblay"
    const unrelatedEntity = makeEntity("9999999999", "construction xyz corp");
    const owner = makeIndividualOwner({ mailing_geocode: GEOCODE_POINT });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByGeocode.mockResolvedValue([unrelatedEntity]);
    mockFindEntitiesByDirector.mockResolvedValue([]); // not a director
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("B");
    expect(result.isAggregator).toBe(false);
    expect(result.reason).toContain("no name link");
  });

  it("6. geocode hits 11 entities → Pipeline B + isAggregator true", async () => {
    const manyEntities = Array.from({ length: 11 }, (_, i) =>
      makeEntity(`900000000${i}`, `entity ${i}`),
    );
    const owner = makeIndividualOwner({ mailing_geocode: GEOCODE_POINT });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByGeocode.mockResolvedValue(manyEntities);
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("B");
    expect(result.isAggregator).toBe(true);
    expect(result.reason).toContain("aggregator");
  });

  it("7. individual, no geocode but is director of 2 entities → Pipeline B + reqEnrichment", async () => {
    const owner = makeIndividualOwner({ mailing_geocode: null });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByDirector.mockResolvedValue([
      { entity: ENTITY_A, director: {} },
      { entity: ENTITY_B, director: {} },
    ]);
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("B");
    expect(result.reqEnrichment?.isDirector).toBe(true);
    expect(result.reqEnrichment?.directorOf).toHaveLength(2);
    expect(result.isAggregator).toBe(false);
  });

  it("8. individual, no geocode, not a director → Pipeline B no enrichment", async () => {
    const owner = makeIndividualOwner({ mailing_geocode: null });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByDirector.mockResolvedValue([]);
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("B");
    expect(result.reqEnrichment).toBeUndefined();
    expect(result.isAggregator).toBe(false);
  });

  it("10. geocode RPC throws → classifier returns Pipeline B (graceful degradation)", async () => {
    const owner = makeIndividualOwner({ mailing_geocode: GEOCODE_POINT });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByGeocode.mockRejectedValue(new Error("function req_entities_near_point does not exist"));
    mockFindEntitiesByDirector.mockResolvedValue([]);
    const sb = makeSupabaseMock();

    // Should NOT throw — graceful degradation expected
    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("B");
    expect(result.isAggregator).toBe(false);
  });
});

describe("routeOwner — error handling", () => {
  it("9. owner not found → throws", async () => {
    mockFindCanonicalOwnerById.mockResolvedValue({ data: null, error: { message: "no rows" } });
    const sb = makeSupabaseMock();

    await expect(routeOwner(sb, "nonexistent-id")).rejects.toThrow(/canonical_owner not found/);
  });
});

describe("routeOwner — lazy geocode integration", () => {
  it("11. individual with no geocode but has mailing_address_raw → getOrFetchGeocode is called", async () => {
    const owner = makeIndividualOwner({
      mailing_geocode: null,
      canonical_name: "Jean Tremblay",
    });
    // Add mailing_address_raw to owner
    const ownerWithAddress = { ...owner, mailing_address_raw: "100 Rue Main, Montréal QC H2X 1A1" };
    mockFindCanonicalOwnerById.mockResolvedValue({ data: ownerWithAddress, error: null });
    mockFindEntitiesByDirector.mockResolvedValue([]);
    // Lazy geocode returns a point
    mockGetOrFetchGeocode.mockResolvedValue({ lat: 45.5, lng: -73.6 });
    mockFindEntitiesByGeocode.mockResolvedValue([]);
    const sb = makeSupabaseMock();

    await routeOwner(sb, owner.owner_id);

    expect(mockGetOrFetchGeocode).toHaveBeenCalledWith(
      sb,
      "canonical_owner",
      "owner_id",
      owner.owner_id,
      ownerWithAddress.mailing_address_raw,
      "mailing_geocode",
    );
  });

  it("12. individual, lazy geocode returns null → falls through to director result Pipeline B", async () => {
    const owner = makeIndividualOwner({ mailing_geocode: null });
    const ownerWithAddress = { ...owner, mailing_address_raw: "123 Rue Test, QC" };
    mockFindCanonicalOwnerById.mockResolvedValue({ data: ownerWithAddress, error: null });
    mockFindEntitiesByDirector.mockResolvedValue([{ entity: ENTITY_A, director: {} }]);
    mockGetOrFetchGeocode.mockResolvedValue(null); // geocoding failed
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("B");
    expect(result.reqEnrichment?.isDirector).toBe(true);
    expect(result.reqEnrichment?.directorOf).toHaveLength(1);
  });

  it("13. individual, name-first: director match returned even when geocode is null", async () => {
    // Owner has no geocode and no mailing_address_raw — pure name-first path
    const owner = makeIndividualOwner({ mailing_geocode: null });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByDirector.mockResolvedValue([
      { entity: ENTITY_A, director: {} },
      { entity: ENTITY_B, director: {} },
    ]);
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    expect(result.pipeline).toBe("B");
    expect(result.reqEnrichment?.isDirector).toBe(true);
    expect(result.reqEnrichment?.directorOf).toHaveLength(2);
    // getOrFetchGeocode should not have been called (null geocode + no address)
    expect(mockGetOrFetchGeocode).not.toHaveBeenCalled();
  });

  it("14. individual, geocode hits 2–10 entities, is a director → Pipeline B + reqEnrichment", async () => {
    const fiveEntities = Array.from({ length: 5 }, (_, i) =>
      makeEntity(`900000000${i}`, `entity ${i}`),
    );
    const owner = makeIndividualOwner({ mailing_geocode: GEOCODE_POINT });
    mockFindCanonicalOwnerById.mockResolvedValue({ data: owner, error: null });
    mockFindEntitiesByGeocode.mockResolvedValue(fiveEntities);
    mockFindEntitiesByDirector.mockResolvedValue([{ entity: ENTITY_A, director: {} }]);
    const sb = makeSupabaseMock();

    const result = await routeOwner(sb, owner.owner_id);

    // 2-10 entity geocode result falls through to director check
    expect(result.pipeline).toBe("B");
    expect(result.reqEnrichment?.isDirector).toBe(true);
    expect(result.isAggregator).toBe(false);
    expect(result.reason).toContain("director");
  });
});
