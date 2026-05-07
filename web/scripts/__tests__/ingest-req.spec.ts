/**
 * Unit tests for the ingest-req script.
 *
 * Tests use a tiny inline fixture CSV rather than the real REQ file.
 * The geocode wrapper is mocked so no HTTP calls or API keys are needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveColumnMapping, mapRow } from "../ingest-req";

// Mock the geocode module so tests never make HTTP calls
vi.mock("../../lib/req/geocode", () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
  resetGeocodeCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

// Simulates the French-column REQ CSV header row
const FIXTURE_HEADERS = [
  "NEQ",
  "NOM_ASSUJ",
  "FORME_JURI",
  "COD_STAT_IMM",
  "DAT_STAT_IMM",
  "NO_CIVIQ_DOMCL",
  "NOM_RUE_DOMCL",
  "NOM_MUNICIPALITE_DOMCL",
  "NOM_PROVINCE_DOMCL",
  "COD_POSTAL_DOMCL",
  "NO_CIVIQ_CORRESP",
  "NOM_RUE_CORRESP",
  "NOM_MUNICIPALITE_CORRESP",
  "NOM_PROVINCE_CORRESP",
  "COD_POSTAL_CORRESP",
  "NO_TELEPH_DOMCL",
  "COD_ACTV_ECON_ASSUJ",
  "NOM_ADMIN",
  "PRENOM_ADMIN",
  "TITRE_ADMIN",
  "DAT_DEBUT_ADMIN",
  "DAT_FIN_ADMIN",
];

const FIXTURE_ROW_1: Record<string, string> = {
  NEQ: "1234567890",
  NOM_ASSUJ: "GESTION TREMBLAY INC",
  FORME_JURI: "Compagnie par actions",
  COD_STAT_IMM: "ACTIF",
  DAT_STAT_IMM: "20200115",
  NO_CIVIQ_DOMCL: "123",
  NOM_RUE_DOMCL: "Rue Principale",
  NOM_MUNICIPALITE_DOMCL: "Montréal",
  NOM_PROVINCE_DOMCL: "QC",
  COD_POSTAL_DOMCL: "H2X 1A1",
  NO_CIVIQ_CORRESP: "456",
  NOM_RUE_CORRESP: "Boul. Saint-Laurent",
  NOM_MUNICIPALITE_CORRESP: "Montréal",
  NOM_PROVINCE_CORRESP: "QC",
  COD_POSTAL_CORRESP: "H2T 2B2",
  NO_TELEPH_DOMCL: "5145551234",
  COD_ACTV_ECON_ASSUJ: "6810",
  NOM_ADMIN: "TREMBLAY",
  PRENOM_ADMIN: "Jean",
  TITRE_ADMIN: "Président",
  DAT_DEBUT_ADMIN: "2020-01-15",
  DAT_FIN_ADMIN: "",
};

const FIXTURE_ROW_NUMBERED: Record<string, string> = {
  NEQ: "9876543210",
  NOM_ASSUJ: "9876-5432 QUÉBEC INC",
  FORME_JURI: "Compagnie par actions",
  COD_STAT_IMM: "INACTIF",
  DAT_STAT_IMM: "20230601",
  NO_CIVIQ_DOMCL: "",
  NOM_RUE_DOMCL: "",
  NOM_MUNICIPALITE_DOMCL: "",
  NOM_PROVINCE_DOMCL: "",
  COD_POSTAL_DOMCL: "",
  NO_CIVIQ_CORRESP: "",
  NOM_RUE_CORRESP: "",
  NOM_MUNICIPALITE_CORRESP: "",
  NOM_PROVINCE_CORRESP: "",
  COD_POSTAL_CORRESP: "",
  NO_TELEPH_DOMCL: "",
  COD_ACTV_ECON_ASSUJ: "",
  NOM_ADMIN: "",
  PRENOM_ADMIN: "",
  TITRE_ADMIN: "",
  DAT_DEBUT_ADMIN: "",
  DAT_FIN_ADMIN: "",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveColumnMapping", () => {
  it("maps French REQ headers to internal fields correctly", () => {
    const mapping = resolveColumnMapping(FIXTURE_HEADERS);
    expect(mapping.neq).toBe("NEQ");
    expect(mapping.legal_name).toBe("NOM_ASSUJ");
    expect(mapping.status).toBe("COD_STAT_IMM");
    expect(mapping.mail_addr_postal).toBe("COD_POSTAL_CORRESP");
    expect(mapping.dir_surname).toBe("NOM_ADMIN");
  });

  it("is deterministic — same headers always produce same mapping", () => {
    const m1 = resolveColumnMapping(FIXTURE_HEADERS);
    const m2 = resolveColumnMapping(FIXTURE_HEADERS);
    expect(m1).toEqual(m2);
  });

  it("tolerates extra unknown columns without crashing", () => {
    const headers = [...FIXTURE_HEADERS, "CHAMP_INCONNU", "AUTRE_CHAMP"];
    expect(() => resolveColumnMapping(headers)).not.toThrow();
  });
});

describe("mapRow — entity parsing", () => {
  const mapping = resolveColumnMapping(FIXTURE_HEADERS);

  it("parses NEQ and legal name", () => {
    const { entity } = mapRow(FIXTURE_ROW_1, mapping);
    expect(entity).not.toBeNull();
    expect(entity!.neq).toBe("1234567890");
    expect(entity!.legal_name).toBe("GESTION TREMBLAY INC");
  });

  it("normalizes legal name (strips INC suffix, strips accents)", () => {
    const { entity } = mapRow(FIXTURE_ROW_1, mapping);
    expect(entity!.legal_name_normalized).toBe("gestion tremblay");
  });

  it("builds mailing address from component columns", () => {
    const { entity } = mapRow(FIXTURE_ROW_1, mapping);
    expect(entity!.mailing_address_raw).toContain("Boul. Saint-Laurent");
    expect(entity!.mailing_address_raw).toContain("Montréal");
  });

  it("extracts FSA from mailing postal code", () => {
    const { entity } = mapRow(FIXTURE_ROW_1, mapping);
    expect(entity!.postal_fsa).toBe("H2T");
  });

  it("parses YYYYMMDD date format to ISO", () => {
    const { entity } = mapRow(FIXTURE_ROW_1, mapping);
    expect(entity!.status_date).toBe("2020-01-15");
  });

  it("handles numbered company name normalization", () => {
    const { entity } = mapRow(FIXTURE_ROW_NUMBERED, mapping);
    expect(entity!.neq).toBe("9876543210");
    expect(entity!.legal_name_normalized).toBe("9876 5432 quebec");
  });

  it("returns null entity when NEQ is missing", () => {
    const rowWithNoNeq = { ...FIXTURE_ROW_1, NEQ: "" };
    const { entity } = mapRow(rowWithNoNeq, mapping);
    expect(entity).toBeNull();
  });
});

describe("mapRow — director parsing", () => {
  const mapping = resolveColumnMapping(FIXTURE_HEADERS);

  it("parses director surname, given name, and role", () => {
    const { director } = mapRow(FIXTURE_ROW_1, mapping);
    expect(director).not.toBeNull();
    expect(director!.surname).toBe("TREMBLAY");
    expect(director!.given_name).toBe("Jean");
    expect(director!.role).toBe("Président");
  });

  it("normalizes director full name", () => {
    const { director } = mapRow(FIXTURE_ROW_1, mapping);
    expect(director!.full_name_normalized).toBe("jean tremblay");
  });

  it("sets end_date to null when the field is empty", () => {
    const { director } = mapRow(FIXTURE_ROW_1, mapping);
    expect(director!.end_date).toBeNull();
  });

  it("returns null director when NOM_ADMIN is empty", () => {
    const { director } = mapRow(FIXTURE_ROW_NUMBERED, mapping);
    expect(director).toBeNull();
  });
});
