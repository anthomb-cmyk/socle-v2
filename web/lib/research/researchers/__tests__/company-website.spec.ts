import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the import of the unit under test
// ---------------------------------------------------------------------------

vi.mock("../../../brave", () => ({
  braveSearch: vi.fn(),
}));

vi.mock("../../db", () => ({
  insertEvidence: vi.fn().mockResolvedValue({
    data: { evidence_id: "ev-cw-001" },
    error: null,
  }),
}));

import { companyWebsiteResearcher } from "../company-website";
import * as brave from "../../../brave";
import * as db from "../../db";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockBraveSearch = brave.braveSearch as ReturnType<typeof vi.fn>;
const mockInsertEvidence = db.insertEvidence as ReturnType<typeof vi.fn>;

function makeOwner() {
  return {
    owner_id: "owner-001",
    owner_type: "named_co" as const,
    canonical_name: "Gestion Tremblay Inc",
    canonical_name_normalized: "gestion tremblay",
    neq: "9000000001",
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
    neq: "9000000001",
    legal_name: "Gestion Tremblay Inc",
    legal_name_normalized: "gestion tremblay",
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
  mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-cw-001" }, error: null });
  // Default: fetch returns empty HTML
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  } as Response);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("companyWebsiteResearcher", () => {
  it("returns empty array when braveSearch returns no results", async () => {
    mockBraveSearch.mockResolvedValue([]);

    const candidates = await companyWebsiteResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(0);
    expect(mockInsertEvidence).not.toHaveBeenCalled();
  });

  it("extracts phone from snippet when braveSearch returns a result", async () => {
    mockBraveSearch.mockResolvedValue([
      { url: "https://example.ca/contact", title: "Gestion Tremblay", snippet: "Appelez-nous: (514) 555-1234" },
    ]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const candidates = await companyWebsiteResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+15145551234");
    expect(candidates[0].source).toBe("company_website");
    expect(candidates[0].isAuthoritative).toBe(false);
    expect(candidates[0].sourceUrl).toBe("https://example.ca/contact");
  });

  it("extracts phone from fetched HTML body", async () => {
    mockBraveSearch.mockResolvedValue([
      { url: "https://example.ca/contact", title: "Gestion Tremblay", snippet: "" },
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<p>Téléphone: 514-555-9876</p>",
    } as Response);

    const candidates = await companyWebsiteResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+15145559876");
    expect(mockInsertEvidence).toHaveBeenCalledWith(
      fakeSb,
      expect.objectContaining({
        source: "company_website",
        source_url: "https://example.ca/contact",
        owner_id: "owner-001",
      }),
    );
  });

  it("deduplicates the same phone found in snippet and HTML", async () => {
    mockBraveSearch.mockResolvedValue([
      { url: "https://example.ca", title: "Gestion Tremblay", snippet: "Call 514-555-1234" },
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<p>Tel: (514) 555-1234</p>",
    } as Response);

    const candidates = await companyWebsiteResearcher(fakeSb, makeOwner(), makeTarget());

    // Same phone from snippet and HTML — should be deduplicated
    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+15145551234");
  });

  it("handles fetch failure gracefully and still returns snippet phones", async () => {
    mockBraveSearch.mockResolvedValue([
      { url: "https://example.ca/contact", title: "Tremblay", snippet: "514-555-7890" },
    ]);
    // Simulate network error on fetch
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const candidates = await companyWebsiteResearcher(fakeSb, makeOwner(), makeTarget());

    // Phone from snippet should still be returned despite fetch failure
    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+15145557890");
  });

  it("processes at most 3 result URLs", async () => {
    const results = Array.from({ length: 6 }, (_, i) => ({
      url: `https://example${i}.ca`,
      title: `Result ${i}`,
      snippet: `514-55${i}-0000`,
    }));
    mockBraveSearch.mockResolvedValue(results);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const candidates = await companyWebsiteResearcher(fakeSb, makeOwner(), makeTarget());

    // At most 3 pages fetched, each contributing 1 phone
    expect(candidates.length).toBeLessThanOrEqual(3);
  });

  it("returns empty array when braveSearch throws", async () => {
    mockBraveSearch.mockRejectedValue(new Error("BRAVE_API_KEY not set"));

    const candidates = await companyWebsiteResearcher(fakeSb, makeOwner(), makeTarget());

    expect(candidates).toHaveLength(0);
  });
});
