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

// ---------------------------------------------------------------------------
// Tests
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

describe("findEntitiesByName", () => {
  it("returns exact matches when found", async () => {
    const sb = makeSupabaseMock([mockEntity]);
    const result = await findEntitiesByName(sb as never, "gestion tremblay");

    expect(sb.from).toHaveBeenCalledWith("req_entities");
    expect(result).toHaveLength(1);
    expect(result[0].neq).toBe("1234567890");
  });

  it("falls back to ILIKE prefix when exact match is empty", async () => {
    // First call (exact) returns [], second call (ilike) returns a result
    const builder1 = makeQueryBuilder([]);
    const builder2 = makeQueryBuilder([mockEntity]);

    let callCount = 0;
    const sb = {
      from: vi.fn(() => {
        callCount++;
        return callCount === 1 ? builder1 : builder2;
      }),
    };

    const result = await findEntitiesByName(sb as never, "gestion tremb");
    expect(result).toHaveLength(1);
  });
});

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
