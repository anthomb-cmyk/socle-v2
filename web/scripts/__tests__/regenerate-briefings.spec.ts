/**
 * Unit tests for scripts/regenerate-briefings.ts
 *
 * Tests focus on deriveBriefingInput — the input-derivation function that maps
 * CRM lead rows to BriefingInput objects — to ensure it doesn't silently drop
 * fields.
 *
 * No DB calls or LLM calls are made in this file.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the briefing module so importing the script doesn't trigger side effects
vi.mock("../../lib/llm/briefing", () => ({
  renderBriefingTemplate: vi.fn((input: unknown) => JSON.stringify(input)),
  renderBriefingPhrased: vi.fn(async (input: unknown) => JSON.stringify(input)),
  detectLanguage: vi.fn(() => "en"),
}));

// Mock @supabase/supabase-js to prevent network calls on import
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

import { deriveBriefingInput } from "../regenerate-briefings";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeLeadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-test-1",
    pipeline: null,
    contacts: {
      full_name: "Jean-Pierre Gagnon",
      company_name: null,
      kind: "individual",
      mailing_address: "12 rue du Moulin",
      mailing_city: "Québec",
      mailing_postal: "G1A 2B3",
      neq: null,
    },
    properties: [
      {
        matricule: "123-456-789",
        address: "12 rue du Moulin",
        city: "Québec",
        num_units: 8,
        evaluation_total: 950_000,
        year_built: 1995,
      },
    ],
    phones: [
      {
        e164: "+14185551234",
        confidence: 80,
        is_direct: true,
        source: "pages_jaunes",
        tier: "B",
        label: "likely",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveBriefingInput", () => {
  it("maps all fields correctly from a complete lead row", () => {
    const lead = makeLeadRow();
    const result = deriveBriefingInput(lead as Parameters<typeof deriveBriefingInput>[0]);

    expect(result).not.toBeNull();
    const r = result!;

    // Owner
    expect(r.owner.canonicalName).toBe("Jean-Pierre Gagnon");
    expect(r.owner.ownerType).toBe("individual");
    expect(r.owner.mailingAddress).toContain("12 rue du Moulin");
    expect(r.owner.mailingAddress).toContain("Québec");
    expect(r.owner.neq).toBeNull();

    // Pipeline inferred from ownerType (individual → B)
    expect(r.pipeline).toBe("B");

    // Properties
    expect(r.properties).toHaveLength(1);
    expect(r.properties[0].matricule).toBe("123-456-789");
    expect(r.properties[0].address).toBe("12 rue du Moulin");
    expect(r.properties[0].city).toBe("Québec");
    expect(r.properties[0].nUnits).toBe(8);
    expect(r.properties[0].assessmentTotal).toBe(950_000);
    expect(r.properties[0].yearBuilt).toBe(1995);

    // Phone
    expect(r.primaryPhone.e164).toBe("+14185551234");
    expect(r.primaryPhone.tier).toBe("B");
    expect(r.primaryPhone.label).toBe("likely");
    expect(r.primaryPhone.isDirect).toBe(true);
    expect(r.primarySource).toBe("pages_jaunes");
    expect(r.secondarySource).toBeNull();
  });

  it("returns null when contacts are missing", () => {
    const lead = makeLeadRow({ contacts: null });
    const result = deriveBriefingInput(lead as Parameters<typeof deriveBriefingInput>[0]);
    expect(result).toBeNull();
  });

  it("returns null when properties are empty", () => {
    const lead = makeLeadRow({ properties: [] });
    const result = deriveBriefingInput(lead as Parameters<typeof deriveBriefingInput>[0]);
    expect(result).toBeNull();
  });

  it("returns null when phones are empty", () => {
    const lead = makeLeadRow({ phones: [] });
    const result = deriveBriefingInput(lead as Parameters<typeof deriveBriefingInput>[0]);
    expect(result).toBeNull();
  });

  it("picks the best phone by confidence and uses second phone as secondary source", () => {
    const lead = makeLeadRow({
      phones: [
        { e164: "+14185550001", confidence: 50, is_direct: false, source: "canada411", tier: "C", label: "connected" },
        { e164: "+14185550002", confidence: 90, is_direct: true, source: "req_phone", tier: "A", label: "confirmed" },
      ],
    });
    const result = deriveBriefingInput(lead as Parameters<typeof deriveBriefingInput>[0]);

    expect(result).not.toBeNull();
    expect(result!.primaryPhone.e164).toBe("+14185550002"); // highest confidence
    expect(result!.primarySource).toBe("req_phone");
    expect(result!.secondarySource).toBe("canada411");
  });

  it("maps company lead (named_co) to Pipeline A", () => {
    const lead = makeLeadRow({
      contacts: {
        full_name: null,
        company_name: "GESTION DUPONT INC",
        kind: "named_co",
        mailing_address: "300 boul. Saint-Joseph",
        mailing_city: "Montréal",
        mailing_postal: "H2T 1J3",
        neq: "9876543210",
      },
    });
    const result = deriveBriefingInput(lead as Parameters<typeof deriveBriefingInput>[0]);

    expect(result).not.toBeNull();
    expect(result!.pipeline).toBe("A");
    expect(result!.owner.canonicalName).toBe("GESTION DUPONT INC");
    expect(result!.owner.neq).toBe("9876543210");
  });

  it("respects explicitly set pipeline field on lead", () => {
    const lead = makeLeadRow({ pipeline: "A" });
    const result = deriveBriefingInput(lead as Parameters<typeof deriveBriefingInput>[0]);
    expect(result!.pipeline).toBe("A");
  });

  it("uses company_name as fallback when full_name is null", () => {
    const lead = makeLeadRow({
      contacts: {
        full_name: null,
        company_name: "IMMO TEST INC",
        kind: "named_co",
        mailing_address: null,
        mailing_city: null,
        mailing_postal: null,
        neq: null,
      },
    });
    const result = deriveBriefingInput(lead as Parameters<typeof deriveBriefingInput>[0]);
    expect(result!.owner.canonicalName).toBe("IMMO TEST INC");
  });
});
