/**
 * reverse-address.spec.ts — Tests for the reverse-address researcher.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports of the unit under test
// ---------------------------------------------------------------------------

vi.mock("../../../brave", () => ({
  braveSearch: vi.fn(),
}));

vi.mock("../../db", () => ({
  insertEvidence: vi.fn().mockResolvedValue({
    data: { evidence_id: "ev-ra-001" },
    error: null,
  }),
}));

import { reverseAddressResearcher } from "../reverse-address";
import * as brave from "../../../brave";
import * as db from "../../db";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockBraveSearch = brave.braveSearch as ReturnType<typeof vi.fn>;
const mockInsertEvidence = db.insertEvidence as ReturnType<typeof vi.fn>;

function makeOwner(overrides: Partial<{
  mailing_address_raw: string | null;
  mailing_postal_fsa: string | null;
}> = {}) {
  return {
    owner_id: "owner-ra-001",
    owner_type: "individual" as const,
    canonical_name: "Jean Tremblay",
    canonical_name_normalized: "jean tremblay",
    neq: null,
    mailing_address_raw: "123 Rue Principale, Montréal, QC H3B 1A1",
    mailing_geocode: null,
    mailing_postal_fsa: "H3B",
    dedupe_status: "pending_review" as const,
    is_aggregator_address: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const fakeSb = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-ra-001" }, error: null });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  } as Response);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reverseAddressResearcher", () => {
  it("returns empty array when mailing_address_raw is null", async () => {
    const candidates = await reverseAddressResearcher(fakeSb, makeOwner({ mailing_address_raw: null }));

    expect(candidates).toHaveLength(0);
    expect(mockBraveSearch).not.toHaveBeenCalled();
  });

  it("returns empty array when mailing_address_raw is blank", async () => {
    const candidates = await reverseAddressResearcher(fakeSb, makeOwner({ mailing_address_raw: "   " }));

    expect(candidates).toHaveLength(0);
    expect(mockBraveSearch).not.toHaveBeenCalled();
  });

  it("returns empty array when braveSearch returns no results", async () => {
    mockBraveSearch.mockResolvedValue([]);

    const candidates = await reverseAddressResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(0);
    expect(mockInsertEvidence).not.toHaveBeenCalled();
  });

  it("extracts phone from snippet and inserts evidence with correct source", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://canada411.ca/res/123-rue-principale",
        title: "Jean Tremblay - 123 Rue Principale",
        snippet: "Téléphone: (514) 555-1234",
      },
    ]);

    const candidates = await reverseAddressResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+15145551234");
    expect(candidates[0].source).toBe("reverse_address");
    expect(candidates[0].isAuthoritative).toBe(false);
    expect(candidates[0].sourceUrl).toBe("https://canada411.ca/res/123-rue-principale");
    expect(mockInsertEvidence).toHaveBeenCalledWith(
      fakeSb,
      expect.objectContaining({
        source: "reverse_address",
        owner_id: "owner-ra-001",
        source_url: "https://canada411.ca/res/123-rue-principale",
      }),
    );
  });

  it("extracts phone from fetched HTML body", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://example.ca/contact",
        title: "Jean Tremblay",
        snippet: "",
      },
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<p>Phone: 514-555-9876</p>",
    } as Response);

    const candidates = await reverseAddressResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+15145559876");
  });

  it("deduplicates phones found in both snippet and HTML", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://example.ca",
        title: "Jean Tremblay",
        snippet: "Call 514-555-1234",
      },
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<p>Tel: (514) 555-1234</p>",
    } as Response);

    const candidates = await reverseAddressResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(1);
  });

  it("processes at most 3 result URLs", async () => {
    const results = Array.from({ length: 6 }, (_, i) => ({
      url: `https://example${i}.ca`,
      title: `Result ${i}`,
      snippet: `514-55${i}-0000`,
    }));
    mockBraveSearch.mockResolvedValue(results);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const candidates = await reverseAddressResearcher(fakeSb, makeOwner());

    expect(candidates.length).toBeLessThanOrEqual(3);
  });

  it("returns empty array when braveSearch throws (soft fail)", async () => {
    mockBraveSearch.mockRejectedValue(new Error("BRAVE_API_KEY not set"));

    const candidates = await reverseAddressResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(0);
  });

  it("includes the address in the brave search query", async () => {
    mockBraveSearch.mockResolvedValue([]);

    await reverseAddressResearcher(fakeSb, makeOwner());

    expect(mockBraveSearch).toHaveBeenCalledWith(
      expect.stringContaining("123 Rue Principale"),
      expect.any(Number),
    );
    expect(mockBraveSearch).toHaveBeenCalledWith(
      expect.stringMatching(/telephone|phone|téléphone/i),
      expect.any(Number),
    );
  });
});
