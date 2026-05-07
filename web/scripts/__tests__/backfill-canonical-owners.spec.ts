/**
 * Tests for the backfill-canonical-owners script.
 *
 * All supabase queries are mocked — no real DB calls or network access.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyOwnerType,
  deriveCanonicalName,
  runBackfill,
} from "../backfill-canonical-owners";

// Mock geocode so no HTTP calls are made
vi.mock("../../lib/req/geocode", () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
  resetGeocodeCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: unknown };

/**
 * Build a chainable mock that returns `result` at every terminal method.
 */
function makeChain(result: MockResult) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "insert",
    "upsert",
    "eq",
    "not",
    "is",
    "range",
    "limit",
    "maybeSingle",
    "single",
  ] as const;
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  (chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  (chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  (chain.range as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  (chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  return chain;
}

/**
 * Minimal Supabase mock. `tableResponses` maps table name → result for
 * each successive call to `from(tableName)`. Excess calls return `defaultResult`.
 */
function makeSbMock(
  defaultResult: MockResult,
  tableResponses: Record<string, MockResult[]> = {},
) {
  const callCounts: Record<string, number> = {};
  return {
    from: vi.fn((table: string) => {
      callCounts[table] = (callCounts[table] ?? 0) + 1;
      const responses = tableResponses[table];
      if (responses) {
        const idx = callCounts[table] - 1;
        const result = responses[idx] ?? defaultResult;
        return makeChain(result);
      }
      return makeChain(defaultResult);
    }),
    _callCounts: callCounts,
  };
}

// ---------------------------------------------------------------------------
// classifyOwnerType
// ---------------------------------------------------------------------------

describe("classifyOwnerType", () => {
  it("maps person → individual", () => {
    expect(classifyOwnerType("person", null)).toBe("individual");
  });

  it("maps numbered_co → numbered_co", () => {
    expect(classifyOwnerType("numbered_co", "9274-8490 Quebec Inc")).toBe("numbered_co");
  });

  it("maps trust → trust", () => {
    expect(classifyOwnerType("trust", "Fiducie Famille Tremblay")).toBe("trust");
  });

  it("maps company with letters → named_co", () => {
    expect(classifyOwnerType("company", "Gestion Tremblay Inc")).toBe("named_co");
  });

  it("maps company with leading digits → numbered_co", () => {
    expect(classifyOwnerType("company", "9123-4567 Québec Inc")).toBe("numbered_co");
  });

  it("maps unknown → individual (safe default)", () => {
    expect(classifyOwnerType("unknown", null)).toBe("individual");
  });
});

// ---------------------------------------------------------------------------
// deriveCanonicalName
// ---------------------------------------------------------------------------

describe("deriveCanonicalName", () => {
  it("uses full_name for persons", () => {
    const contact = {
      id: "x",
      kind: "person" as const,
      full_name: "Jean Tremblay",
      company_name: null,
      numbered_co_id: null,
      mailing_address: null,
      mailing_city: null,
      mailing_province: null,
      mailing_postal: null,
    };
    expect(deriveCanonicalName(contact)).toBe("Jean Tremblay");
  });

  it("uses company_name for companies", () => {
    const contact = {
      id: "y",
      kind: "company" as const,
      full_name: "Gestion Tremblay Inc",
      company_name: "Gestion Tremblay Inc",
      numbered_co_id: null,
      mailing_address: null,
      mailing_city: null,
      mailing_province: null,
      mailing_postal: null,
    };
    expect(deriveCanonicalName(contact)).toBe("Gestion Tremblay Inc");
  });
});

// ---------------------------------------------------------------------------
// runBackfill — alias-only insert when exact match found
// ---------------------------------------------------------------------------

describe("runBackfill — alias-only insert on exact match", () => {
  it("does not insert a new canonical_owner row when dedupe returns exact", async () => {
    const existingOwnerId = "existing-owner-uuid";

    const contacts = [
      {
        id: "contact-1",
        kind: "person",
        full_name: "Jean Tremblay",
        company_name: null,
        numbered_co_id: null,
        mailing_address: null,
        mailing_city: null,
        mailing_province: null,
        mailing_postal: "H2X 1A1",
      },
    ];

    const sb = makeSbMock(
      { data: null, error: null },
      {
        contacts: [{ data: contacts, error: null }, { data: [], error: null }],
        property_contacts: [{ data: [], error: null }],
        properties: [{ data: [], error: null }],
        // Stage 1: canonical_owner returns an existing row (name+FSA match)
        canonical_owner: [
          { data: [{ owner_id: existingOwnerId }], error: null },
        ],
        owner_alias: [{ data: null, error: null }],
      },
    );

    const result = await runBackfill(sb as never);

    // No new canonical_owner should be inserted
    expect(result.canonicalOwnersInserted).toBe(0);
    // Alias should be inserted
    expect(result.aliasesInserted).toBe(1);
    expect(result.contactsProcessed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runBackfill — idempotence (two runs produce same row counts)
// ---------------------------------------------------------------------------

describe("runBackfill — idempotence", () => {
  it("inserting twice produces the same net canonical_owner count", async () => {
    const contacts = [
      {
        id: "contact-2",
        kind: "company",
        full_name: "Gestion ABC Inc",
        company_name: "Gestion ABC Inc",
        numbered_co_id: null,
        mailing_address: "100 Rue Main",
        mailing_city: "Montréal",
        mailing_province: "QC",
        mailing_postal: "H3B 2Y5",
      },
    ];

    // First run: no existing owner → insert new
    function makeFreshSb() {
      return makeSbMock(
        { data: null, error: null },
        {
          contacts: [{ data: contacts, error: null }, { data: [], error: null }],
          property_contacts: [{ data: [], error: null }],
          properties: [{ data: [], error: null }],
          canonical_owner: [
            { data: [], error: null }, // Stage 1 name+FSA: no hit
            { data: [], error: null }, // Stage 2 fuzzy: no hit
            { data: { owner_id: "new-owner-id" }, error: null }, // insert returns new id
          ],
          owner_alias: [
            { data: [], error: null }, // Stage 1b: no alias hit
            { data: null, error: null }, // alias insert OK
          ],
        },
      );
    }

    const sb1 = makeFreshSb();
    const result1 = await runBackfill(sb1 as never);
    expect(result1.canonicalOwnersInserted).toBe(1);

    // Second run: existing owner found → alias only
    const sb2 = makeSbMock(
      { data: null, error: null },
      {
        contacts: [{ data: contacts, error: null }, { data: [], error: null }],
        property_contacts: [{ data: [], error: null }],
        properties: [{ data: [], error: null }],
        canonical_owner: [
          { data: [{ owner_id: "new-owner-id" }], error: null }, // Stage 1: hit!
        ],
        owner_alias: [
          { data: null, error: null }, // alias insert (idempotent — conflict ignored)
        ],
      },
    );
    const result2 = await runBackfill(sb2 as never);

    // Second run inserts 0 new canonical_owner rows (already exists)
    expect(result2.canonicalOwnersInserted).toBe(0);
    expect(result2.aliasesInserted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runBackfill — raw_property insertion
// ---------------------------------------------------------------------------

describe("runBackfill — raw_property rows", () => {
  it("inserts a raw_property row for each linked property", async () => {
    const contacts = [
      {
        id: "contact-3",
        kind: "person",
        full_name: "Marie Dupont",
        company_name: null,
        numbered_co_id: null,
        mailing_address: null,
        mailing_city: null,
        mailing_province: null,
        mailing_postal: null,
      },
    ];

    const propertyContacts = [
      { contact_id: "contact-3", property_id: "prop-uuid-1", source_import_job_id: null },
      { contact_id: "contact-3", property_id: "prop-uuid-2", source_import_job_id: "job-abc" },
    ];

    const properties = [
      { id: "prop-uuid-1", matricule: "MAT-001" },
      { id: "prop-uuid-2", matricule: "MAT-002" },
    ];

    const sb = makeSbMock(
      { data: null, error: null },
      {
        contacts: [{ data: contacts, error: null }, { data: [], error: null }],
        property_contacts: [{ data: propertyContacts, error: null }],
        properties: [{ data: properties, error: null }],
        canonical_owner: [
          // Stage 1 name+FSA: no hit
          { data: [], error: null },
          // insert returns new owner (no Stage 2 since no geocode key in tests)
          { data: { owner_id: "new-owner-uuid" }, error: null },
        ],
        owner_alias: [
          { data: [], error: null }, // Stage 1b alias probe
          { data: null, error: null }, // alias insert
        ],
        raw_property: [
          { data: null, error: null },
          { data: null, error: null },
        ],
      },
    );

    const result = await runBackfill(sb as never);
    expect(result.rawPropertiesInserted).toBe(2);
  });
});
