/**
 * req-address.spec.ts - Tests for the REQ-by-address Pipeline B researcher.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CanonicalOwnerRow } from "../../db";
import type { ReqEntity } from "../../../req/types";

vi.mock("../../../brave", () => ({
  braveSearch: vi.fn(),
}));

vi.mock("../../db", () => ({
  insertEvidence: vi.fn().mockResolvedValue({
    data: { evidence_id: "ev-req-address-001" },
    error: null,
  }),
}));

import { reqAddressResearcher } from "../req-address";
import * as brave from "../../../brave";
import * as db from "../../db";

const mockBraveSearch = brave.braveSearch as ReturnType<typeof vi.fn>;
const mockInsertEvidence = db.insertEvidence as ReturnType<typeof vi.fn>;

function makeOwner(overrides: Partial<CanonicalOwnerRow> = {}): CanonicalOwnerRow {
  return {
    owner_id: "owner-req-address-001",
    owner_type: "individual",
    canonical_name: "Jean Tremblay",
    canonical_name_normalized: "jean tremblay",
    neq: null,
    mailing_address_raw: "123 Rue Principale, Saint-Hyacinthe, QC J2S 3A4",
    mailing_geocode: null,
    mailing_postal_fsa: "J2S",
    dedupe_status: "pending_review",
    is_aggregator_address: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeReqEntity(overrides: Partial<ReqEntity> = {}): ReqEntity {
  return {
    neq: "1170000001",
    legal_name: "Gestion Principale Inc.",
    legal_name_normalized: "gestion principale inc",
    juridical_form: null,
    status: "ACTIF",
    status_date: null,
    registered_address_raw: "123 rue Principale, Saint-Hyacinthe, QC J2S 3A4",
    mailing_address_raw: null,
    registered_geocode: null,
    mailing_geocode: null,
    postal_fsa: "J2S",
    registered_phone: null,
    activity_codes: null,
    imported_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSb(rows: ReqEntity[], error: { message: string } | null = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBraveSearch.mockResolvedValue([]);
  mockInsertEvidence.mockResolvedValue({
    data: { evidence_id: "ev-req-address-001" },
    error: null,
  });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  } as Response);
});

describe("reqAddressResearcher", () => {
  it("returns a registered REQ phone for a matching owner mailing address", async () => {
    const sb = makeSb([
      makeReqEntity({ registered_phone: "(450) 555-1234" }),
      makeReqEntity({
        neq: "1170000002",
        registered_address_raw: "999 rue Autre, Saint-Hyacinthe, QC J2S 1A1",
        registered_phone: "(450) 555-9999",
      }),
    ]);

    const candidates = await reqAddressResearcher(sb as never, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        source: "req_address_lookup",
        phone: "+14505551234",
        isAuthoritative: true,
      }),
    );
    expect(mockBraveSearch).not.toHaveBeenCalled();
    expect(mockInsertEvidence).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({
        owner_id: "owner-req-address-001",
        source: "req_address_lookup",
        source_url: "https://www.registreentreprises.gouv.qc.ca/",
      }),
    );
  });

  it("searches the matched business online when REQ has no registered phone", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.pagesjaunes.ca/bus/gestion-principale",
        title: "Gestion Principale Inc.",
        snippet: "Gestion Principale Inc. J2S telephone (450) 555-7788",
      },
    ]);
    const sb = makeSb([makeReqEntity()]);

    const candidates = await reqAddressResearcher(sb as never, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        phone: "+14505557788",
        sourceUrl: "https://www.pagesjaunes.ca/bus/gestion-principale",
        isAuthoritative: false,
      }),
    );
    expect(mockBraveSearch).toHaveBeenCalledWith(
      expect.stringContaining("Gestion Principale Inc."),
      3,
    );
  });

  it("does not search the web when no REQ address rows match locally", async () => {
    const sb = makeSb([
      makeReqEntity({
        registered_address_raw: "999 rue Autre, Saint-Hyacinthe, QC J2S 1A1",
      }),
    ]);

    const candidates = await reqAddressResearcher(sb as never, makeOwner());

    expect(candidates).toHaveLength(0);
    expect(mockBraveSearch).not.toHaveBeenCalled();
    expect(mockInsertEvidence).not.toHaveBeenCalled();
  });

  it("normalizes a full postal code to its FSA before querying req_entities", async () => {
    const sb = makeSb([]);

    await reqAddressResearcher(
      sb as never,
      makeOwner({ mailing_postal_fsa: "J2S3A4" }),
    );

    expect(sb._chain.eq).toHaveBeenCalledWith("postal_fsa", "J2S");
  });

  it("soft-fails when req_entities lookup returns an error", async () => {
    const sb = makeSb([], { message: "database unavailable" });

    const candidates = await reqAddressResearcher(sb as never, makeOwner());

    expect(candidates).toHaveLength(0);
    expect(mockBraveSearch).not.toHaveBeenCalled();
  });
});
