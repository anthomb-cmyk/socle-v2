/**
 * Unit tests for lookup helpers.
 * All DB calls are mocked so no real Supabase connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findEntitiesByName,
  findEntitiesByDirector,
  getDirectorsForEntity,
  findEntitiesByGeocode,
} from "../lookup";
import type { ReqEntity, ReqDirector } from "../types";

// ---------------------------------------------------------------------------
// Minimal Supabase mock builder
// ---------------------------------------------------------------------------

function makeRpcMock(data: unknown, error: unknown = null) {
  return vi.fn().mockResolvedValue({ data, error });
}

function makeQueryBuilder(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  const terminal = { data, error };

  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.ilike = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  // Make the builder thenable so `await sb.from(...).select(...)...` works
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(terminal).then(resolve);

  return builder;
}

function makeSupabaseMock(
  fromData: unknown = [],
  fromError: unknown = null,
  rpcData: unknown = [],
) {
  const builder = makeQueryBuilder(fromData, fromError);
  return {
    from: vi.fn(() => builder),
    rpc: makeRpcMock(rpcData),
    _builder: builder, // expose for assertion
  };
}

/**
 * Build a mock that returns different data per `from()` table call.
 * tableMap: { tableName: returnData }
 */
function makeMultiTableMock(tableMap: Record<string, unknown>) {
  const builders: Record<string, ReturnType<typeof makeQueryBuilder>> = {};
  for (const [table, data] of Object.entries(tableMap)) {
    builders[table] = makeQueryBuilder(data);
  }
  return {
    from: vi.fn((table: string) => builders[table] ?? makeQueryBuilder([])),
    _builders: builders,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockEntity: ReqEntity = {
  neq: "1234567890",
  legal_name: "Gestion Tremblay Inc",
  legal_name_normalized: "gestion tremblay",
  juridical_form: "Compagnie par actions",
  status: "ACTIF",
  status_date: "2020-01-01",
  registered_address_raw: "123 Rue Main, Montréal, QC H2X 1A1",
  mailing_address_raw: "123 Rue Main, Montréal, QC H2X 1A1",
  registered_geocode: null,
  mailing_geocode: null,
  postal_fsa: "H2X",
  registered_phone: null,
  activity_codes: ["6810"],
  imported_at: "2025-01-01T00:00:00Z",
};

const mockEntityAlias: ReqEntity = {
  neq: "9876543210",
  legal_name: "Constructions Rivard Inc",
  legal_name_normalized: "constructions rivard",
  juridical_form: "Compagnie par actions",
  status: "ACTIF",
  status_date: "2018-03-01",
  registered_address_raw: "456 Boul. Industriel, Québec, QC G1K 2B2",
  mailing_address_raw: null,
  registered_geocode: null,
  mailing_geocode: null,
  postal_fsa: "G1K",
  registered_phone: null,
  activity_codes: ["4120"],
  imported_at: "2025-01-01T00:00:00Z",
};

const mockDirector: ReqDirector = {
  id: "uuid-1",
  neq: "1234567890",
  full_name: "Jean Tremblay",
  full_name_normalized: "jean tremblay",
  surname: "Tremblay",
  given_name: "Jean",
  role: "Président",
  start_date: "2020-01-01",
  end_date: null,
};

// ---------------------------------------------------------------------------
// Tests — findEntitiesByName (primary + alias)
// ---------------------------------------------------------------------------

describe("findEntitiesByName", () => {
  it("returns exact matches when found on primary table", async () => {
    const sb = makeSupabaseMock([mockEntity]);
    const result = await findEntitiesByName(sb as never, "gestion tremblay");

    expect(sb.from).toHaveBeenCalledWith("req_entities");
    expect(result).toHaveLength(1);
    expect(result[0].neq).toBe("1234567890");
  });

  it("falls back to ILIKE prefix when exact match is empty", async () => {
    // First from("req_entities") exact → []
    // Second from("req_entity_alias") → []
    // Third from("req_entities") ilike → [mockEntity]
    let reqEntitiesCallCount = 0;
    const entityBuilder1 = makeQueryBuilder([]);
    const entityBuilder2 = makeQueryBuilder([mockEntity]);
    const aliasBuilder = makeQueryBuilder([]);

    const sb = {
      from: vi.fn((table: string) => {
        if (table === "req_entity_alias") return aliasBuilder;
        reqEntitiesCallCount++;
        return reqEntitiesCallCount === 1 ? entityBuilder1 : entityBuilder2;
      }),
    };

    const result = await findEntitiesByName(sb as never, "gestion tremb");
    expect(result).toHaveLength(1);
    expect(result[0].neq).toBe("1234567890");
  });

  it("returns alias-matched entities when primary exact match is empty but alias matches", async () => {
    // Primary exact → [], alias → [{neq: '9876543210'}], then entities.in() → [mockEntityAlias]
    const aliasRows = [{ neq: "9876543210" }];
    const entityExactBuilder = makeQueryBuilder([]);
    const aliasBuilder = makeQueryBuilder(aliasRows);
    const entityInBuilder = makeQueryBuilder([mockEntityAlias]);

    let reqEntitiesCallCount = 0;
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "req_entity_alias") return aliasBuilder;
        reqEntitiesCallCount++;
        return reqEntitiesCallCount === 1 ? entityExactBuilder : entityInBuilder;
      }),
    };

    const result = await findEntitiesByName(sb as never, "rivard construction");
    expect(result).toHaveLength(1);
    expect(result[0].neq).toBe("9876543210");
  });

  it("deduplicates when multiple alias rows point to the same NEQ", async () => {
    const aliasRows = [{ neq: "9876543210" }, { neq: "9876543210" }];
    const entityExactBuilder = makeQueryBuilder([]);
    const aliasBuilder = makeQueryBuilder(aliasRows);
    const entityInBuilder = makeQueryBuilder([mockEntityAlias]);

    let reqEntitiesCallCount = 0;
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "req_entity_alias") return aliasBuilder;
        reqEntitiesCallCount++;
        return reqEntitiesCallCount === 1 ? entityExactBuilder : entityInBuilder;
      }),
    };

    const result = await findEntitiesByName(sb as never, "old rivard name");
    // The in() query receives a deduped array — result depends on entity mock
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no primary, alias, or prefix matches found", async () => {
    const emptyBuilder = makeQueryBuilder([]);
    const sb = {
      from: vi.fn(() => emptyBuilder),
    };
    const result = await findEntitiesByName(sb as never, "completely unknown name xyz");
    expect(result).toHaveLength(0);
  });

  it("skips alias lookup when primary exact match already found", async () => {
    // If exact match returns results, alias lookup should NOT be called
    const sb = makeSupabaseMock([mockEntity]);
    const result = await findEntitiesByName(sb as never, "gestion tremblay");

    // from() should have been called only once (for req_entities exact match)
    // The alias table should NOT have been queried
    const callArgs = (sb.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(callArgs).not.toContain("req_entity_alias");
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — getDirectorsForEntity
// ---------------------------------------------------------------------------

describe("getDirectorsForEntity", () => {
  it("filters by end_date IS NULL when currentOnly=true (default)", async () => {
    const sb = makeSupabaseMock([mockDirector]);
    await getDirectorsForEntity(sb as never, "1234567890");

    expect(sb._builder.eq).toHaveBeenCalledWith("neq", "1234567890");
    expect(sb._builder.is).toHaveBeenCalledWith("end_date", null);
  });

  it("does NOT apply end_date filter when currentOnly=false", async () => {
    const sb = makeSupabaseMock([mockDirector]);
    await getDirectorsForEntity(sb as never, "1234567890", false);

    expect(sb._builder.eq).toHaveBeenCalledWith("neq", "1234567890");
    expect(sb._builder.is).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — findEntitiesByDirector
// ---------------------------------------------------------------------------

describe("findEntitiesByDirector", () => {
  it("returns entity+director pairs for matching full_name_normalized", async () => {
    const rowWithJoin = { ...mockDirector, req_entities: mockEntity };
    const sb = makeSupabaseMock([rowWithJoin]);

    const result = await findEntitiesByDirector(sb as never, "jean tremblay");

    expect(sb.from).toHaveBeenCalledWith("req_directors");
    expect(result).toHaveLength(1);
    expect(result[0].director.neq).toBe("1234567890");
    expect(result[0].entity.legal_name).toBe("Gestion Tremblay Inc");
  });

  it("returns empty array when no directors match", async () => {
    const sb = makeSupabaseMock([]);
    const result = await findEntitiesByDirector(sb as never, "unknown person");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — findEntitiesByGeocode
// ---------------------------------------------------------------------------

describe("findEntitiesByGeocode", () => {
  it("calls rpc for both mailing and registered geocodes and dedupes by neq", async () => {
    // Both rpc calls return the same entity — should be deduped to 1 result
    const sb = {
      rpc: vi.fn().mockResolvedValue({ data: [mockEntity], error: null }),
    };

    const result = await findEntitiesByGeocode(sb as never, 45.5, -73.6, 75);

    expect(sb.rpc).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].neq).toBe("1234567890");
  });

  it("returns empty array when both rpc calls return null data", async () => {
    const sb = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const result = await findEntitiesByGeocode(sb as never, 45.5, -73.6, 75);
    expect(result).toHaveLength(0);
  });
});
