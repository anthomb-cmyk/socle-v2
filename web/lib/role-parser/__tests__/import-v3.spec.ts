import { describe, it, expect } from "vitest";
import { parseNameFromFields, parseFullNameOnly } from "../name-parser";
import { isLikelyGivenName, isLikelyCompoundGivenName } from "../given-names";
import { validateAndEnrichRow } from "../import-validator";
import type { ParsedRow } from "../types";

// ── Name parser ─────────────────────────────────────────────────────────────

describe("name-parser — basic cases", () => {
  it("'Tremblay, Jean' → first=Jean, last=Tremblay", () => {
    const r = parseFullNameOnly("Tremblay, Jean");
    expect(r.firstName).toBe("Jean");
    expect(r.lastName).toBe("Tremblay");
    expect(r.parseQuality).toBe("complete");
  });

  it("'Jean Tremblay' → first=Jean, last=Tremblay", () => {
    const r = parseFullNameOnly("Jean Tremblay");
    expect(r.firstName).toBe("Jean");
    expect(r.lastName).toBe("Tremblay");
  });

  it("compound prénom with hyphen: 'Marie-Claire Bouchard' → first=Marie-Claire", () => {
    const r = parseFullNameOnly("Marie-Claire Bouchard");
    expect(r.firstName).toBe("Marie-Claire");
    expect(r.lastName).toBe("Bouchard");
  });

  it("compound prénom without hyphen: 'Marie Claire Bouchard' → first=Marie Claire", () => {
    const r = parseFullNameOnly("Marie Claire Bouchard");
    expect(r.firstName).toBe("Marie Claire");
    expect(r.lastName).toBe("Bouchard");
  });

  it("middle name in fullname: 'Marius Ioan Boitiu' → first=Marius, last=Ioan Boitiu", () => {
    const r = parseFullNameOnly("Marius Ioan Boitiu");
    // Default: first=Marius, last=Ioan Boitiu (middle gets prepended into last).
    expect(r.firstName).toBe("Marius");
    // Note: full-name-only path keeps default behavior — middles join into last.
    expect(r.lastName).toContain("Boitiu");
  });

  it("single token → only last name", () => {
    const r = parseFullNameOnly("Lapointe");
    expect(r.firstName).toBeNull();
    expect(r.lastName).toBe("Lapointe");
    expect(r.parseQuality).toBe("single_token");
  });
});

describe("name-parser — separate prénom/nom fields", () => {
  it("standard: prénom='Jean', nom='Tremblay'", () => {
    const r = parseNameFromFields({ prenomField: "Jean", nomField: "Tremblay" });
    expect(r.firstName).toBe("Jean");
    expect(r.lastName).toBe("Tremblay");
    expect(r.wasInverted).toBe(false);
    expect(r.parseQuality).toBe("complete");
  });

  it("INVERTED: prénom='LAPOINTE', nom='Richard' → swapped", () => {
    const r = parseNameFromFields({ prenomField: "LAPOINTE", nomField: "Richard" });
    expect(r.wasInverted).toBe(true);
    expect(r.firstName).toBe("Richard");
    expect(r.lastName).toBe("Lapointe");
    expect(r.parseQuality).toBe("inverted_corrected");
  });

  it("MIDDLE NAME in prénom: prénom='Marius Ioan', nom='Boitiu' → middle moved", () => {
    const r = parseNameFromFields({ prenomField: "Marius Ioan", nomField: "Boitiu" });
    expect(r.firstName).toBe("Marius");
    expect(r.lastName).toBe("Ioan Boitiu");
    expect(r.middleNames).toEqual(["Ioan"]);
    expect(r.parseQuality).toBe("middle_moved");
  });

  it("compound prénom kept whole when both parts in prénom column", () => {
    const r = parseNameFromFields({ prenomField: "Marie-Claire", nomField: "Tremblay" });
    expect(r.firstName).toBe("Marie-Claire");
    expect(r.lastName).toBe("Tremblay");
  });

  it("ambiguous: prénom='Bouchard', nom='Lavigueur' (both could be surnames) → leave as-is", () => {
    const r = parseNameFromFields({ prenomField: "Bouchard", nomField: "Lavigueur" });
    // Neither token is a known given name; we should NOT swap.
    expect(r.wasInverted).toBe(false);
    expect(r.firstName).toBe("Bouchard");
    expect(r.lastName).toBe("Lavigueur");
  });

  it("does not swap when both look like given names", () => {
    const r = parseNameFromFields({ prenomField: "Marie", nomField: "Anne" });
    expect(r.wasInverted).toBe(false);
  });
});

describe("given-names list", () => {
  it("recognizes compound prénoms", () => {
    expect(isLikelyCompoundGivenName("Marie Claire")).toBe(true);
    expect(isLikelyCompoundGivenName("Jean Pierre")).toBe(true);
    expect(isLikelyCompoundGivenName("Pierre Tremblay")).toBe(false);  // not a known compound
  });

  it("recognizes hyphenated compound prénoms", () => {
    expect(isLikelyGivenName("Marie-Claire")).toBe(true);
    expect(isLikelyGivenName("Jean-Pascal")).toBe(true);
  });

  it("rejects pure surnames", () => {
    expect(isLikelyGivenName("Lapointe")).toBe(false);
    expect(isLikelyGivenName("Bouchard")).toBe(false);
    expect(isLikelyGivenName("Tremblay")).toBe(false);
  });
});

// ── Import-validator integration ─────────────────────────────────────────────
// llmFallback is disabled in tests to avoid network calls.

const NO_LLM = { hardBlockUnparseableMailing: true, llmFallback: false };
const NO_LLM_SOFT = { hardBlockUnparseableMailing: false, llmFallback: false };

describe("import-validator — mailing-address quality", () => {
  function makeRow(mailingAddress: string, mailingCity?: string | null): ParsedRow {
    return {
      row_number: 1,
      property: { address: "1 rue Test", city: "Granby", raw_role_row: {} },
      owners: [{
        kind: "person",
        full_name: "Jean Tremblay",
        first_name: "Jean",
        last_name: "Tremblay",
        phones: [],
        source_columns: {},
        mailing_address: mailingAddress,
        mailing_city: mailingCity ?? undefined,
      }],
      errors: [],
    };
  }

  it("complete address gets quality=complete", async () => {
    const row = makeRow("3720 Avenue Kent, Montréal QC H3S 1N3", "Montréal");
    const audit = await validateAndEnrichRow(row, NO_LLM);
    expect(row.owners[0].mailing_parse_quality).toBe("complete");
    expect(row.owners[0].mailing_civic).toBe("3720");
    expect(row.owners[0].mailing_postal).toBe("H3S 1N3");
    expect(audit.blocking).toHaveLength(0);
  });

  it("missing-street address blocks the row", async () => {
    const row = makeRow("BROMONT QC J2L 2X5", "Bromont");
    const audit = await validateAndEnrichRow(row, NO_LLM);
    expect(row.owners[0].mailing_parse_quality).not.toBe("complete");
    expect(audit.blocking.length).toBeGreaterThan(0);
  });

  it("incoherent city is flagged but not blocked", async () => {
    const row = makeRow("3720 Avenue Kent, Montréal QC H3S 1N3", "Granby");
    const audit = await validateAndEnrichRow(row, NO_LLM_SOFT);
    expect(row.owners[0].mailing_parse_quality).toBe("incoherent_city");
    expect(audit.warnings.some(w => w.includes("disagrees"))).toBe(true);
    expect(audit.blocking).toHaveLength(0);
  });
});

describe("import-validator — name inversion correction", () => {
  it("corrects an inverted prénom/nom", async () => {
    const row: ParsedRow = {
      row_number: 1,
      property: { address: "1 rue Test", city: "Granby", raw_role_row: {} },
      owners: [{
        kind: "person",
        full_name: "Lapointe Richard",
        first_name: "LAPOINTE",
        last_name: "Richard",
        phones: [],
        source_columns: {},
        mailing_address: "3720 Avenue Kent, Montréal QC H3S 1N3",
      }],
      errors: [],
    };
    await validateAndEnrichRow(row, NO_LLM);
    expect(row.owners[0].first_name).toBe("Richard");
    expect(row.owners[0].last_name).toBe("Lapointe");
    expect(row.owners[0].name_was_inverted).toBe(true);
    expect(row.owners[0].name_parse_quality).toBe("inverted_corrected");
  });

  it("moves middle names from prénom to nom", async () => {
    const row: ParsedRow = {
      row_number: 1,
      property: { address: "1 rue Test", city: "Granby", raw_role_row: {} },
      owners: [{
        kind: "person",
        full_name: "Marius Ioan Boitiu",
        first_name: "Marius Ioan",
        last_name: "Boitiu",
        phones: [],
        source_columns: {},
        mailing_address: "3720 Avenue Kent, Montréal QC H3S 1N3",
      }],
      errors: [],
    };
    await validateAndEnrichRow(row, NO_LLM);
    expect(row.owners[0].first_name).toBe("Marius");
    expect(row.owners[0].last_name).toBe("Ioan Boitiu");
    expect(row.owners[0].middle_names).toEqual(["Ioan"]);
  });
});
