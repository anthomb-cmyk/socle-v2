/**
 * whats-interesting.spec.ts — Tests for the "what's interesting" rules engine.
 */

import { describe, it, expect } from "vitest";
import { computeWhatsInteresting } from "../whats-interesting";
import type { WhatsInterestingInput } from "../whats-interesting";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return an ISO date string N months ago from today. */
function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

/** Properties that do NOT trigger Rule 4 (modern build, modest per-unit assessment). */
function baseProperties(count = 1) {
  return Array.from({ length: count }, (_, i) => ({
    matricule: `9940-00-0000-${i}-001`,
    address: `${i + 1} Rue Test, Montréal`,
    n_units: 10,
    year_built: 2010, // not older than 50 years
    assessment_total: 2_000_000, // $200k/unit — below $500k threshold
  }));
}

// ---------------------------------------------------------------------------
// Rule 1: Director name change in last 24 months
// ---------------------------------------------------------------------------
describe("Rule 1 — recently inherited", () => {
  it("directors_changed_at within 24 months → returns director change message", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Jean Tremblay", owner_type: "individual" },
      reqHistory: [{ neq: "9001", status: "ACTIF", directors_changed_at: monthsAgo(6) }],
      properties: baseProperties(),
    };
    const result = computeWhatsInteresting(input);
    expect(result).toMatch(/Director listing changed/);
    expect(result).toMatch(/possible recent transition/);
  });

  it("directors_changed_at older than 24 months → does not trigger Rule 1", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Jean Tremblay", owner_type: "individual" },
      reqHistory: [{ neq: "9001", status: "ACTIF", directors_changed_at: monthsAgo(30) }],
      properties: baseProperties(),
    };
    const result = computeWhatsInteresting(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 2: Corporate restructure in last 12 months
// ---------------------------------------------------------------------------
describe("Rule 2 — corporate restructure", () => {
  it("status_date within 12 months → returns restructure message", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Corp XYZ Inc", owner_type: "named_co" },
      reqHistory: [{ neq: "9002", status: "ACTIF", status_date: monthsAgo(3) }],
      properties: baseProperties(),
    };
    const result = computeWhatsInteresting(input);
    expect(result).toMatch(/Recent corporate restructure/);
    expect(result).toMatch(/status change in/);
  });

  it("status_date older than 12 months → does not trigger Rule 2", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Corp XYZ Inc", owner_type: "named_co" },
      reqHistory: [{ neq: "9002", status: "ACTIF", status_date: monthsAgo(18) }],
      properties: baseProperties(),
    };
    const result = computeWhatsInteresting(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 3: Many buildings, no phone found
// ---------------------------------------------------------------------------
describe("Rule 3 — many buildings, no confirmed phone", () => {
  it("5+ properties, 0 confirmed, 1+ attempts → returns sophisticated owner message", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Gestion Anonyme Inc", owner_type: "named_co" },
      properties: baseProperties(6),
      hypothesisSearchHistory: { attempts: 3, confirmedCount: 0 },
    };
    const result = computeWhatsInteresting(input);
    expect(result).toMatch(/Owns 6 buildings/);
    expect(result).toMatch(/sophisticated owner/);
  });

  it("only 4 properties → does not trigger Rule 3", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Gestion Anonyme Inc", owner_type: "named_co" },
      properties: baseProperties(4),
      hypothesisSearchHistory: { attempts: 3, confirmedCount: 0 },
    };
    const result = computeWhatsInteresting(input);
    expect(result).toBeNull();
  });

  it("5+ properties but confirmedCount=1 → does not trigger Rule 3", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Gestion Anonyme Inc", owner_type: "named_co" },
      properties: baseProperties(5),
      hypothesisSearchHistory: { attempts: 3, confirmedCount: 1 },
    };
    const result = computeWhatsInteresting(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 4: Old property, high per-unit assessment
// ---------------------------------------------------------------------------
describe("Rule 4 — old property with high per-unit assessment", () => {
  it("50+ year old property with per-unit > $500k → returns assessment message", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Marie Dubois", owner_type: "individual" },
      properties: [
        {
          matricule: "9940-00-1234-5-001",
          address: "100 Ave du Parc, Montréal",
          n_units: 4,
          year_built: 1960,
          assessment_total: 2_400_000, // $600k/unit
        },
      ],
    };
    const result = computeWhatsInteresting(input);
    expect(result).toMatch(/4-unit at 100 Ave du Parc/);
    expect(result).toMatch(/high per-unit assessment/);
  });

  it("old property but per-unit ≤ $500k → does not trigger Rule 4", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Marie Dubois", owner_type: "individual" },
      properties: [
        {
          matricule: "9940-00-1234-5-001",
          address: "100 Ave du Parc, Montréal",
          n_units: 10,
          year_built: 1960,
          assessment_total: 3_000_000, // $300k/unit
        },
      ],
    };
    const result = computeWhatsInteresting(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 5: Owner-occupier
// ---------------------------------------------------------------------------
describe("Rule 5 — owner-occupier", () => {
  it("mailing geocode within 50m of a property → returns owner-occupier message", () => {
    const point = { lat: 45.5017, lng: -73.5673 };
    const nearbyPoint = { lat: 45.50172, lng: -73.56732 }; // ~3 m away
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Paul Gagnon", owner_type: "individual", mailing_geocode: point },
      properties: [
        {
          matricule: "9940-01-0001-1-001",
          address: "1 Rue Sherbrooke, Montréal",
          n_units: 6,
          geocode: nearbyPoint,
        },
      ],
    };
    const result = computeWhatsInteresting(input);
    expect(result).toMatch(/owner-occupier/);
  });

  it("mailing geocode far from all properties → does not trigger Rule 5", () => {
    const ownerPoint = { lat: 45.5017, lng: -73.5673 };
    const farPoint = { lat: 45.6000, lng: -73.6000 }; // ~12 km away
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Paul Gagnon", owner_type: "individual", mailing_geocode: ownerPoint },
      properties: [
        {
          matricule: "9940-01-0001-1-001",
          address: "2 Rue Sherbrooke, Montréal",
          n_units: 6,
          geocode: farPoint,
        },
      ],
    };
    const result = computeWhatsInteresting(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Null case: nothing interesting
// ---------------------------------------------------------------------------
describe("null case", () => {
  it("no rules match → returns null", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Nondescript Holdings Inc", owner_type: "named_co" },
      reqHistory: [],
      properties: [
        {
          matricule: "9940-00-0000-0-001",
          address: "99 Rue Quelconque",
          n_units: 3,
          year_built: 2010,
          assessment_total: 900_000, // $300k/unit, < $500k
        },
      ],
      hypothesisSearchHistory: { attempts: 1, confirmedCount: 1 },
    };
    const result = computeWhatsInteresting(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Priority: Rule 1 wins over Rule 2
// ---------------------------------------------------------------------------
describe("priority ordering", () => {
  it("Rule 1 fires before Rule 2 when both conditions are met", () => {
    const input: WhatsInterestingInput = {
      owner: { canonical_name: "Corp ABC", owner_type: "named_co" },
      reqHistory: [
        {
          neq: "9003",
          status: "ACTIF",
          directors_changed_at: monthsAgo(6),
          status_date: monthsAgo(3),
        },
      ],
      properties: baseProperties(),
    };
    const result = computeWhatsInteresting(input);
    expect(result).toMatch(/Director listing changed/);
  });
});
