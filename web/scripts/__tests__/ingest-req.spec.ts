/**
 * Unit tests for the ingest-req script.
 *
 * Tests use a tiny inline fixture CSV rather than the real REQ file.
 * The geocode wrapper is mocked so no HTTP calls or API keys are needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveColumnMapping,
  mapRow,
  parseNomRow,
  resolveCurrentName,
  parseEtabRow,
  parseDateField,
} from "../ingest-req";

// Mock the geocode module so tests never make HTTP calls
vi.mock("../../lib/req/geocode", () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
  resetGeocodeCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixture data — Entreprise.csv
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
// Tests — Entreprise.csv
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

// ---------------------------------------------------------------------------
// Fixture data — Nom.csv
// ---------------------------------------------------------------------------

// NEQ 111: two rows — one current (endDate empty), one expired
// NEQ 222: two rows — both expired, pick latest by startDate
// NEQ 333: one current row only (no aliases)

const NOM_ROW_111_CURRENT: Record<string, string> = {
  NEQ: "1110000000",
  NOM_ASSUJ: "GESTION ALPHA INC",
  NOM_ASSUJ_LANG_ETRNG: "",
  STAT_NOM: "A",
  TYP_NOM_ASSUJ: "C",
  DAT_INIT_NOM_ASSUJ: "2020-01-01",
  DAT_FIN_NOM_ASSUJ: "",
};

const NOM_ROW_111_EXPIRED: Record<string, string> = {
  NEQ: "1110000000",
  NOM_ASSUJ: "ALPHA MANAGEMENT INC",
  NOM_ASSUJ_LANG_ETRNG: "",
  STAT_NOM: "I",
  TYP_NOM_ASSUJ: "A",
  DAT_INIT_NOM_ASSUJ: "2015-03-15",
  DAT_FIN_NOM_ASSUJ: "2019-12-31",
};

const NOM_ROW_222_OLDER: Record<string, string> = {
  NEQ: "2220000000",
  NOM_ASSUJ: "BETA SERVICES LTEE",
  NOM_ASSUJ_LANG_ETRNG: "",
  STAT_NOM: "I",
  TYP_NOM_ASSUJ: "C",
  DAT_INIT_NOM_ASSUJ: "2010-06-01",
  DAT_FIN_NOM_ASSUJ: "2018-05-31",
};

const NOM_ROW_222_NEWER: Record<string, string> = {
  NEQ: "2220000000",
  NOM_ASSUJ: "NOUVELLES BETA LTEE",
  NOM_ASSUJ_LANG_ETRNG: "",
  STAT_NOM: "I",
  TYP_NOM_ASSUJ: "C",
  DAT_INIT_NOM_ASSUJ: "2018-06-01",
  DAT_FIN_NOM_ASSUJ: "2022-12-31",
};

const NOM_ROW_333_ONLY: Record<string, string> = {
  NEQ: "3330000000",
  NOM_ASSUJ: "GAMMA CONSTRUCTION INC",
  NOM_ASSUJ_LANG_ETRNG: "",
  STAT_NOM: "A",
  TYP_NOM_ASSUJ: "C",
  DAT_INIT_NOM_ASSUJ: "2019-07-01",
  DAT_FIN_NOM_ASSUJ: "",
};

// ---------------------------------------------------------------------------
// Tests — Nom.csv parsing
// ---------------------------------------------------------------------------

describe("parseNomRow", () => {
  it("parses a current row (empty DAT_FIN) correctly", () => {
    const result = parseNomRow(NOM_ROW_111_CURRENT);
    expect(result).not.toBeNull();
    expect(result!.neq).toBe("1110000000");
    expect(result!.name).toBe("GESTION ALPHA INC");
    expect(result!.isCurrent).toBe(true);
    expect(result!.endDate).toBeNull();
  });

  it("parses an expired row (non-empty DAT_FIN) correctly", () => {
    const result = parseNomRow(NOM_ROW_111_EXPIRED);
    expect(result).not.toBeNull();
    expect(result!.isCurrent).toBe(false);
    expect(result!.endDate).toBe("2019-12-31");
    expect(result!.aliasType).toBe("A");
  });

  it("returns null when NEQ is missing", () => {
    const row = { ...NOM_ROW_111_CURRENT, NEQ: "" };
    expect(parseNomRow(row)).toBeNull();
  });

  it("returns null when NOM_ASSUJ is missing", () => {
    const row = { ...NOM_ROW_111_CURRENT, NOM_ASSUJ: "" };
    expect(parseNomRow(row)).toBeNull();
  });
});

describe("resolveCurrentName", () => {
  it("picks the current (open-ended) name and treats others as aliases", () => {
    const rows = [
      parseNomRow(NOM_ROW_111_CURRENT)!,
      parseNomRow(NOM_ROW_111_EXPIRED)!,
    ];
    const result = resolveCurrentName(rows);
    expect(result).not.toBeNull();
    expect(result!.currentName).toBe("GESTION ALPHA INC");
    expect(result!.aliases).toHaveLength(1);
    expect(result!.aliases[0].name).toBe("ALPHA MANAGEMENT INC");
  });

  it("when all rows are expired, picks latest by startDate", () => {
    const rows = [
      parseNomRow(NOM_ROW_222_OLDER)!,
      parseNomRow(NOM_ROW_222_NEWER)!,
    ];
    const result = resolveCurrentName(rows);
    expect(result).not.toBeNull();
    expect(result!.currentName).toBe("NOUVELLES BETA LTEE");
    expect(result!.aliases).toHaveLength(1);
    expect(result!.aliases[0].name).toBe("BETA SERVICES LTEE");
  });

  it("returns single row with no aliases when only one name exists", () => {
    const rows = [parseNomRow(NOM_ROW_333_ONLY)!];
    const result = resolveCurrentName(rows);
    expect(result).not.toBeNull();
    expect(result!.currentName).toBe("GAMMA CONSTRUCTION INC");
    expect(result!.aliases).toHaveLength(0);
  });

  it("returns null for empty input", () => {
    expect(resolveCurrentName([])).toBeNull();
  });

  it("preserves alias type and dates in the aliases array", () => {
    const rows = [
      parseNomRow(NOM_ROW_111_CURRENT)!,
      parseNomRow(NOM_ROW_111_EXPIRED)!,
    ];
    const result = resolveCurrentName(rows)!;
    const alias = result.aliases[0];
    expect(alias.aliasType).toBe("A");
    expect(alias.startDate).toBe("2015-03-15");
    expect(alias.endDate).toBe("2019-12-31");
  });
});

// ---------------------------------------------------------------------------
// Fixture data — Etablissements.csv
// ---------------------------------------------------------------------------

const ETAB_PRINCIPAL: Record<string, string> = {
  NEQ: "4440000000",
  NO_SUF_ETAB: "01",
  IND_ETAB_PRINC: "1",
  IND_SALON_BRONZ: "0",
  IND_VENTE_TABAC_DETL: "0",
  IND_DISP: "A",
  LIGN1_ADR: "100 Rue Commerce",
  LIGN2_ADR: "Bureau 200",
  LIGN3_ADR: "Laval QC H7N 1A1",
  LIGN4_ADR: "",
  COD_ACT_ECON: "4711",
  DESC_ACT_ECON_ETAB: "Épiceries",
  NO_ACT_ECON_ETAB: "",
  COD_ACT_ECON2: "",
  DESC_ACT_ECON_ETAB2: "",
  NO_ACT_ECON_ETAB2: "",
  NOM_ETAB: "Super Marché Alpha",
};

const ETAB_SECONDARY: Record<string, string> = {
  NEQ: "4440000000",
  NO_SUF_ETAB: "02",
  IND_ETAB_PRINC: "0",
  IND_SALON_BRONZ: "0",
  IND_VENTE_TABAC_DETL: "0",
  IND_DISP: "A",
  LIGN1_ADR: "999 Rue Secondaire",
  LIGN2_ADR: "",
  LIGN3_ADR: "",
  LIGN4_ADR: "",
  COD_ACT_ECON: "4711",
  DESC_ACT_ECON_ETAB: "Épiceries",
  NO_ACT_ECON_ETAB: "",
  COD_ACT_ECON2: "",
  DESC_ACT_ECON_ETAB2: "",
  NO_ACT_ECON_ETAB2: "",
  NOM_ETAB: "Succursale Secondaire",
};

const ETAB_MISSING_ADDR: Record<string, string> = {
  NEQ: "5550000000",
  NO_SUF_ETAB: "01",
  IND_ETAB_PRINC: "1",
  IND_SALON_BRONZ: "0",
  IND_VENTE_TABAC_DETL: "0",
  IND_DISP: "A",
  LIGN1_ADR: "",
  LIGN2_ADR: "",
  LIGN3_ADR: "",
  LIGN4_ADR: "",
  COD_ACT_ECON: "",
  DESC_ACT_ECON_ETAB: "",
  NO_ACT_ECON_ETAB: "",
  COD_ACT_ECON2: "",
  DESC_ACT_ECON_ETAB2: "",
  NO_ACT_ECON_ETAB2: "",
  NOM_ETAB: "",
};

// ---------------------------------------------------------------------------
// Tests — Etablissements.csv parsing
// ---------------------------------------------------------------------------

describe("parseEtabRow", () => {
  it("parses the principal establishment and builds address from non-empty lines", () => {
    const result = parseEtabRow(ETAB_PRINCIPAL);
    expect(result).not.toBeNull();
    expect(result!.neq).toBe("4440000000");
    expect(result!.addressRaw).toContain("100 Rue Commerce");
    expect(result!.addressRaw).toContain("Bureau 200");
    expect(result!.addressRaw).toContain("Laval QC H7N 1A1");
    // LIGN4 is empty — should not appear
    expect(result!.addressRaw).not.toContain(",,");
  });

  it("ignores secondary establishments (IND_ETAB_PRINC != '1')", () => {
    const result = parseEtabRow(ETAB_SECONDARY);
    expect(result).toBeNull();
  });

  it("returns null when principal establishment has no address lines", () => {
    const result = parseEtabRow(ETAB_MISSING_ADDR);
    expect(result).toBeNull();
  });

  it("returns null when NEQ is missing", () => {
    const row = { ...ETAB_PRINCIPAL, NEQ: "" };
    expect(parseEtabRow(row)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — parseDateField (additional coverage)
// ---------------------------------------------------------------------------

describe("parseDateField", () => {
  it("returns null for empty string", () => {
    expect(parseDateField("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseDateField(undefined)).toBeNull();
  });

  it("converts YYYYMMDD to ISO format", () => {
    expect(parseDateField("20230615")).toBe("2023-06-15");
  });

  it("accepts ISO dates as-is", () => {
    expect(parseDateField("2023-06-15")).toBe("2023-06-15");
  });

  it("converts DD/MM/YYYY to ISO format", () => {
    expect(parseDateField("15/06/2023")).toBe("2023-06-15");
  });
});
