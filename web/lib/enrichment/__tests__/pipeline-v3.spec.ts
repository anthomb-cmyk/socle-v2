import { describe, it, expect } from "vitest";
import { runPreflight } from "../preflight";
import { evaluateBraveResult } from "../candidate-evaluator";
import { parseQuebecAddress, fsaFromPostal } from "../address-parser";
import { extractPhonesWithContext } from "../phone-context-extractor";
import { classifyResult } from "../source-classifier";
import { ERR_FIXTURES, GOOD_FIXTURES } from "./fixtures/err-cases";

// Haiku is disabled in tests so we exercise pure deterministic gates.
const NO_HAIKU = { useHaiku: false };

describe("Layer A — preflight", () => {
  it("rejects mailing addresses without a street", () => {
    const r = runPreflight({
      leadId: "x", contactId: "x", enrichmentJobId: "x",
      fullName: null, companyName: null, secondaryName: null,
      propertyAddress: null, propertyCity: null,
      mailingAddress: "BROMONT QC J2L 2X5", mailingCity: "Bromont", mailingPostal: "J2L 2X5",
      matricule: null, numUnits: null,
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some(f => f.includes("missing_civic_number") || f.includes("missing_street_name"))).toBe(true);
  });

  it("accepts a complete mailing address", () => {
    const r = runPreflight({
      leadId: "x", contactId: "x", enrichmentJobId: "x",
      fullName: null, companyName: "Acme Inc",
      secondaryName: null,
      propertyAddress: null, propertyCity: null,
      mailingAddress: "3720 Avenue Kent, Montréal QC H3S 1N3",
      mailingCity: "Montréal", mailingPostal: "H3S 1N3",
      matricule: null, numUnits: null,
    });
    expect(r.ok).toBe(true);
    expect(r.parsed?.civicNumber).toBe("3720");
    expect(r.parsed?.city).toBe("Montréal");
    expect(r.parsed?.postal).toBe("H3S 1N3");
  });

  it("flags city mismatch when mailing_city contradicts the parsed city", () => {
    const r = runPreflight({
      leadId: "x", contactId: "x", enrichmentJobId: "x",
      fullName: null, companyName: null, secondaryName: null,
      propertyAddress: null, propertyCity: "Granby",
      mailingAddress: "3720 Avenue Kent, Montréal QC H3S 1N3",
      mailingCity: "Granby",   // ← contradicts parsed Montréal
      mailingPostal: "H3S 1N3",
      matricule: null, numUnits: null,
    });
    expect(r.cityMatch).toBe("mismatch");
    expect(r.ok).toBe(false);
  });
});

describe("Layer B — address parser", () => {
  it("handles civic ranges", () => {
    const p = parseQuebecAddress("189-197 Rue Desjardins Nord, Granby QC J2G 0A1");
    expect(p.civicNumber).toBe("189");
    expect(p.civicRange).toBe("189-197");
    expect(p.streetName).toBe("Rue Desjardins Nord");
    expect(p.city).toBe("Granby");
  });

  it("handles unit-prefix form '408 - 1020 Rue Levert'", () => {
    const p = parseQuebecAddress("408 - 1020 Rue Levert, Verdun QC H3E 0G4");
    expect(p.unit).toBe("408");
    expect(p.civicNumber).toBe("1020");
    expect(p.streetName).toBe("Rue Levert");
  });

  it("normalizes postal codes", () => {
    const p = parseQuebecAddress("8814 RUE NOTRE-DAME EST, MONTREAL QC H1L 3M3");
    expect(p.postal).toBe("H1L 3M3");
    expect(p.postalFsa).toBe("H1L");
    expect(p.province).toBe("QC");
  });

  // Improvement 4: apartment-prefix form without spaces ("300-150 rue Grant")
  it("handles apartment-prefix form without spaces '300-150 rue Grant' → unit=300, civic=150", () => {
    const p = parseQuebecAddress("300-150 rue Grant, Longueuil QC J4H 3H6");
    expect(p.unit).toBe("300");
    expect(p.civicNumber).toBe("150");
    expect(p.streetName).toBe("rue Grant");
    expect(p.city).toBe("Longueuil");
    expect(p.postal).toBe("J4H 3H6");
  });

  // Ensure original civic-range behaviour is still intact (left < right → range)
  it("still treats '189-197' as a civic range (left < right → not apartment-prefix)", () => {
    const p = parseQuebecAddress("189-197 Rue Desjardins Nord, Granby QC J2G 0A1");
    expect(p.civicNumber).toBe("189");
    expect(p.civicRange).toBe("189-197");
    expect(p.unit).toBeNull();
  });
});

describe("fsaFromPostal helper", () => {
  it("extracts FSA from spaced postal", () => {
    expect(fsaFromPostal("H3S 1N3")).toBe("H3S");
  });

  it("extracts FSA from compact postal (no space)", () => {
    expect(fsaFromPostal("H3S1N3")).toBe("H3S");
  });

  it("returns null for null/undefined input", () => {
    expect(fsaFromPostal(null)).toBeNull();
    expect(fsaFromPostal(undefined)).toBeNull();
    expect(fsaFromPostal("")).toBeNull();
  });

  it("returns null for invalid FSA format", () => {
    expect(fsaFromPostal("123456")).toBeNull();
    expect(fsaFromPostal("AB")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fsaFromPostal("j4h 3h6")).toBe("J4H");
  });
});

describe("Layer C — source classifier", () => {
  it("flags eBay as commerce_unrelated", () => {
    const c = classifyResult({ url: "https://www.ebay.ca/itm/12345", title: "Tires", description: "..." });
    expect(c.sourceClass).toBe("commerce_unrelated");
  });
  it("flags PDFs as bulk_document", () => {
    const c = classifyResult({ url: "https://example.com/foo.pdf", title: "Annuaire", description: "..." });
    expect(c.sourceClass).toBe("bulk_document");
  });
  it("flags 'All retailers in Granby' titles as directory_aggregate", () => {
    const c = classifyResult({ url: "https://depquebec.com/granby", title: "All Détaillants in Granby", description: "..." });
    expect(c.sourceClass).toBe("directory_aggregate");
  });
  it("flags Granby municipal page", () => {
    const c = classifyResult({ url: "https://www.granby.ca/nous-joindre", title: "Nous joindre | Ville de Granby", description: "..." });
    expect(c.sourceClass).toBe("municipal_or_institutional");
  });
  it("flags Canada411 detail pages as authoritative", () => {
    const c = classifyResult({
      url: "https://www.canada411.ca/business/bissonnmutch-multi-logements",
      title: "Bissonnmutch Multi-Logements Inc",
      description: "...",
    });
    expect(c.sourceClass).toBe("directory_authoritative");
  });
});

describe("Layer D — context-aware phone extractor", () => {
  it("rejects NEQ business number even though digits look phone-shaped", () => {
    const out = extractPhonesWithContext("Quebec Business Number / Numéro d'entreprise du Québec: 3367191080");
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reason).toBe("neq_context");
  });
  it("rejects fax-labelled numbers", () => {
    const out = extractPhonesWithContext("Phone: (514) 935-7277  Fax: (514) 935-9999");
    // Phone accepted, fax rejected
    expect(out.accepted.some(p => p.e164 === "+15149357277")).toBe(true);
    expect(out.rejected.some(r => r.reason === "fax_context")).toBe(true);
  });
  it("rejects out-of-region area codes when strict mode is on", () => {
    const out = extractPhonesWithContext("Phone (520) 204-6024", { strictAreaCode: true });
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reason).toBe("out_of_region_non_authoritative");
  });
  it("accepts Quebec area codes in strict mode", () => {
    const out = extractPhonesWithContext("Phone (514) 935-7277", { strictAreaCode: true });
    expect(out.accepted[0]?.e164).toBe("+15149357277");
  });
});

describe("Regression — every documented bad case is rejected/quarantined", () => {
  for (const fx of ERR_FIXTURES) {
    it(`${fx.id}: ${fx.description}`, async () => {
      const preflight = runPreflight(fx.ctx);
      // ERR-002 et al. fail at preflight — that's a successful rejection.
      if (!preflight.ok || !preflight.parsed) {
        // Pass: preflight already filtered the lead before search.
        return;
      }
      const evald = await evaluateBraveResult({
        ctx: fx.ctx,
        parsedAddress: preflight.parsed,
        result: fx.result,
        ...NO_HAIKU,
      });
      expect(evald.candidates.length).toBeGreaterThan(0);
      const best = evald.candidates[0];

      if (fx.expectedDisposition === "any_non_review") {
        expect(["quarantined", "pipeline_rejected", "weak_review"]).toContain(best.report.disposition);
        if (best.report.disposition === "weak_review") {
          expect(best.report.score).toBeLessThan(70);
        }
      } else {
        expect(best.report.disposition).toBe(fx.expectedDisposition);
      }
      if (fx.expectedSourceClassIn && best.classification.sourceClass) {
        expect(fx.expectedSourceClassIn).toContain(best.classification.sourceClass);
      }
    });
  }
});

describe("Regression — synthetic good cases pass gates", () => {
  for (const fx of GOOD_FIXTURES) {
    it(`${fx.id}: ${fx.description}`, async () => {
      const preflight = runPreflight(fx.ctx);
      expect(preflight.ok).toBe(true);
      const evald = await evaluateBraveResult({
        ctx: fx.ctx,
        parsedAddress: preflight.parsed!,
        result: fx.result,
        ...NO_HAIKU,
      });
      expect(evald.candidates.length).toBeGreaterThan(0);
      const best = evald.candidates[0];
      expect(best.classification.sourceClass).toBe(fx.expectedSourceClass);
      expect(best.report.passed).toBe(true);
      expect(best.report.score).toBeGreaterThanOrEqual(fx.minScore);
    });
  }
});
