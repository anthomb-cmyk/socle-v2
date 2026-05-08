/**
 * name-postal-directory.spec.ts — Tests for the name+postal-directory researcher.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../../brave", () => ({
  braveSearch: vi.fn(),
}));

vi.mock("../../db", () => ({
  insertEvidence: vi.fn().mockResolvedValue({
    data: { evidence_id: "ev-npd-001" },
    error: null,
  }),
}));

import { namePostalDirectoryResearcher } from "../name-postal-directory";
import * as brave from "../../../brave";
import * as db from "../../db";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockBraveSearch = brave.braveSearch as ReturnType<typeof vi.fn>;
const mockInsertEvidence = db.insertEvidence as ReturnType<typeof vi.fn>;

function makeOwner(overrides: Partial<{
  canonical_name: string;
  mailing_postal_fsa: string | null;
}> = {}) {
  return {
    owner_id: "owner-npd-001",
    owner_type: "individual" as const,
    canonical_name: "Marie Gagnon",
    canonical_name_normalized: "marie gagnon",
    neq: null,
    mailing_address_raw: "456 Boul Décarie, Montréal, QC H3X 2K8",
    mailing_geocode: null,
    mailing_postal_fsa: "H3X",
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
  mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-npd-001" }, error: null });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  } as Response);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("namePostalDirectoryResearcher", () => {
  it("returns empty array when canonical_name is blank", async () => {
    const candidates = await namePostalDirectoryResearcher(
      fakeSb,
      makeOwner({ canonical_name: "   " }),
    );

    expect(candidates).toHaveLength(0);
    expect(mockBraveSearch).not.toHaveBeenCalled();
  });

  it("returns empty array when braveSearch returns no results", async () => {
    mockBraveSearch.mockResolvedValue([]);

    const candidates = await namePostalDirectoryResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(0);
    expect(mockInsertEvidence).not.toHaveBeenCalled();
  });

  it("sets directoryMatch=true for a pagesjaunes.ca URL", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.pagesjaunes.ca/person/marie-gagnon",
        title: "Marie Gagnon - Pages Jaunes",
        snippet: "Marie Gagnon H3X (514) 555-7777",
      },
    ]);

    const candidates = await namePostalDirectoryResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].directoryMatch).toBe(true);
    expect(candidates[0].source).toBe("name_postal_directory");
    expect(candidates[0].isAuthoritative).toBe(false);
  });

  it("sets directoryMatch=true for a canada411.ca URL", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.canada411.ca/person/marie-gagnon",
        title: "Marie Gagnon",
        snippet: "(514) 555-8888",
      },
    ]);

    const candidates = await namePostalDirectoryResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].directoryMatch).toBe(true);
  });

  it("sets postalCorroborated=true when FSA appears in snippet", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.canada411.ca/person/marie-gagnon",
        title: "Marie Gagnon - H3X",
        snippet: "Marie Gagnon H3X (514) 555-9999",
      },
    ]);

    const candidates = await namePostalDirectoryResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].postalCorroborated).toBe(true);
  });

  it("sets postalCorroborated=false when FSA does not appear in snippet, URL, or HTML", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.canada411.ca/person/marie-gagnon",
        title: "Marie Gagnon",
        snippet: "Marie Gagnon, (514) 555-9999",
      },
    ]);
    // FSA "H3X" not present in URL, snippet, or HTML
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<p>Some content without the FSA</p>",
    } as Response);

    const candidates = await namePostalDirectoryResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].postalCorroborated).toBe(false);
  });

  it("sets directoryMatch=false and postalCorroborated=false for a non-directory URL without FSA", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://randomblog.com/contact",
        title: "Contact",
        snippet: "Call: (514) 555-2222",
      },
    ]);

    const candidates = await namePostalDirectoryResearcher(fakeSb, makeOwner());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].directoryMatch).toBe(false);
    expect(candidates[0].postalCorroborated).toBe(false);
  });

  it("returns candidates without FSA in query when mailing_postal_fsa is null", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://canada411.ca/person/marie-gagnon",
        title: "Marie Gagnon",
        snippet: "(514) 555-3333",
      },
    ]);

    const candidates = await namePostalDirectoryResearcher(
      fakeSb,
      makeOwner({ mailing_postal_fsa: null }),
    );

    expect(candidates).toHaveLength(1);
    // postalCorroborated must be false when FSA is null
    expect(candidates[0].postalCorroborated).toBe(false);
    // Query should still fire (no FSA part in query)
    expect(mockBraveSearch).toHaveBeenCalledWith(
      expect.stringContaining("Marie Gagnon"),
      expect.any(Number),
    );
  });

  it("inserts evidence row with correct metadata", async () => {
    mockBraveSearch.mockResolvedValue([
      {
        url: "https://www.pagesjaunes.ca/person/marie-gagnon",
        title: "Marie Gagnon",
        snippet: "H3X (514) 555-4444",
      },
    ]);

    await namePostalDirectoryResearcher(fakeSb, makeOwner());

    expect(mockInsertEvidence).toHaveBeenCalledWith(
      fakeSb,
      expect.objectContaining({
        source: "name_postal_directory",
        owner_id: "owner-npd-001",
        source_url: "https://www.pagesjaunes.ca/person/marie-gagnon",
      }),
    );
  });
});
