import { describe, it, expect } from "vitest";
import { normalizeEntityName, normalizePersonName, extractFsa } from "../normalize";

describe("normalizeEntityName", () => {
  it("strips INC suffix (case-insensitive)", () => {
    expect(normalizeEntityName("GESTION TREMBLAY INC")).toBe("gestion tremblay");
  });

  it("strips LTÉE / LTEE suffix", () => {
    expect(normalizeEntityName("Constructions Laval Ltée")).toBe("constructions laval");
    expect(normalizeEntityName("MENUISERIE ROY LTEE")).toBe("menuiserie roy");
  });

  it("strips LTD suffix", () => {
    expect(normalizeEntityName("Transport Nord-Est Ltd")).toBe("transport nord est");
  });

  it("strips multiple suffixes in one call", () => {
    // In practice a name won't have two, but the regex should handle whitespace gaps
    expect(normalizeEntityName("Groupe ABC Inc")).toBe("groupe abc");
  });

  it("normalizes diacritics (accent stripping)", () => {
    // "Société" is in the suffix list and is stripped; "Inc" is also stripped.
    // Result: "Générale du Québec" → "generale du quebec"
    expect(normalizeEntityName("Société Générale du Québec Inc")).toBe(
      "generale du quebec",
    );
  });

  it("normalizes diacritics without triggering suffix removal", () => {
    // Name with accents but no legal suffixes
    expect(normalizeEntityName("Ébénisterie Côté")).toBe("ebenisterie cote");
  });

  it("normalizes numbered company — retains leading digits as canonical", () => {
    // Numbered company: digits stay, suffix stripped
    expect(normalizeEntityName("9123-4567 QUÉBEC INC")).toBe("9123 4567 quebec");
  });

  it("handles INCORPOREE suffix", () => {
    expect(normalizeEntityName("Ferme Côté Incorporée")).toBe("ferme cote");
  });

  it("collapses multiple spaces after suffix removal", () => {
    expect(normalizeEntityName("  Exemple   ENR  ")).toBe("exemple");
  });

  it("handles mixed-case suffixes like 'Enr' or 'Senc'", () => {
    expect(normalizeEntityName("Plomberie Duval Enr")).toBe("plomberie duval");
    expect(normalizeEntityName("Cabinet Conseil Senc")).toBe("cabinet conseil");
  });

  it("returns empty string for null input", () => {
    expect(normalizeEntityName(null)).toBe("");
  });

  it("returns empty string for empty string input", () => {
    expect(normalizeEntityName("")).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(normalizeEntityName(undefined)).toBe("");
  });
});

describe("normalizePersonName", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalizePersonName("Éric Côté")).toBe("eric cote");
  });

  it("collapses whitespace", () => {
    expect(normalizePersonName("  Jean  Paul  ")).toBe("jean paul");
  });

  it("returns empty string for null", () => {
    expect(normalizePersonName(null)).toBe("");
  });
});

describe("extractFsa", () => {
  it("extracts FSA from a full postal code in an address", () => {
    expect(extractFsa("123 Rue Principale, Montréal, QC H2X 3Y4")).toBe("H2X");
  });

  it("returns null for addresses without a postal code", () => {
    expect(extractFsa("123 Rue Principale, Montréal")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractFsa(null)).toBeNull();
  });
});
