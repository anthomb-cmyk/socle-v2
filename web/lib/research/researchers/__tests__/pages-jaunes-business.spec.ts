import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../../brave", () => ({
  braveSearch: vi.fn(),
}));

vi.mock("../../db", () => ({
  insertEvidence: vi.fn().mockResolvedValue({
    data: { evidence_id: "ev-pj-001" },
    error: null,
  }),
}));

import { pagesJaunesBusinessResearcher } from "../pages-jaunes-business";
import * as brave from "../../../brave";
import * as db from "../../db";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockBraveSearch = brave.braveSearch as ReturnType<typeof vi.fn>;
const mockInsertEvidence = db.insertEvidence as ReturnType<typeof vi.fn>;

function makeOwner() {
  return {
    owner_id: "owner-002",
    owner_type: "named_co" as const,
    canonical_name: "Immeubles Laval Inc",
    canonical_name_normalized: "immeubles laval",
    neq: "9000000002",
    mailing_address_raw: null,
    mailing_geocode: null,
    mailing_postal_fsa: null,
    dedupe_status: "pending_review" as const,
    is_aggregator_address: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

function makeTarget() {
  return {
    neq: "9000000002",
    legal_name: "Immeubles Laval Inc",
    legal_name_normalized: "immeubles laval",
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
  };
}

const fakeSb = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-pj-001" }, error: null });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  } as Response);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pagesJaunesBusinessResearcher", () => {
  it("returns empty array when braveSearch returns no results", async () => {
    mockBraveSearch.mockResolvedValue([]);

    const candidates = await pagesJaunesBusinessResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(0);
    expect(mockInsertEvidence).not.toHaveBeenCalled();
  });

  it("extracts phone from snippet for a Pages Jaunes result", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.pagesjaunes.ca/bus/Quebec/Montreal/Immeubles-Laval/1234",
        title: "Immeubles Laval Inc",
        snippet: "Téléphone: (450) 555-4321",
      },
    ]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const candidates = await pagesJaunesBusinessResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+14505554321");
    expect(candidates[0].source).toBe("pages_jaunes_business");
    expect(candidates[0].isAuthoritative).toBe(false);
  });

  it("extracts phone from fetched HTML body", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.pagesjaunes.ca/bus/Quebec/Laval/Immeubles-Laval/9876",
        title: "Immeubles Laval Inc",
        snippet: "",
      },
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<span class="phone">450-555-9999</span>',
    } as Response);

    const candidates = await pagesJaunesBusinessResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+14505559999");
    expect(mockInsertEvidence).toHaveBeenCalledWith(
      fakeSb,
      expect.objectContaining({
        source: "pages_jaunes_business",
        source_url: expect.stringContaining("pagesjaunes.ca"),
        owner_id: "owner-002",
      }),
    );
  });

  it("uses the correct Brave query format (site:pagesjaunes.ca)", async () => {
    mockBraveSearch.mockResolvedValue([]);

    await pagesJaunesBusinessResearcher(fakeSb, makeOwner(), makeTarget());

    expect(mockBraveSearch).toHaveBeenCalledWith(
      expect.stringContaining("site:pagesjaunes.ca"),
      expect.any(Number),
    );
    expect(mockBraveSearch).toHaveBeenCalledWith(
      expect.stringContaining('"Immeubles Laval Inc"'),
      expect.any(Number),
    );
  });

  it("deduplicates the same phone across snippet and HTML", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.pagesjaunes.ca/bus/1",
        title: "Immeubles Laval",
        snippet: "450-555-1111",
      },
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<p>(450) 555-1111</p>",
    } as Response);

    const candidates = await pagesJaunesBusinessResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(1);
  });

  it("returns empty array when braveSearch throws", async () => {
    mockBraveSearch.mockRejectedValue(new Error("network error"));

    const candidates = await pagesJaunesBusinessResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(0);
  });

  it("handles fetch failure and still returns snippet phones", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.pagesjaunes.ca/bus/2",
        title: "Immeubles Laval",
        snippet: "450-555-7777",
      },
    ]);
    global.fetch = vi.fn().mockRejectedValue(new Error("timeout"));

    const candidates = await pagesJaunesBusinessResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+14505557777");
  });
});
