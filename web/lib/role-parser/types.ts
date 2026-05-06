// Output shape of the rôle parser — what the import API consumes.

export type RoleFormat = "role_a" | "role_b" | "role_c" | "role_d" | "unknown";

export interface ParsedProperty {
  address: string;
  city: string | null;
  province?: string;
  postal_code?: string;
  matricule?: string;
  cadastre?: string;
  year_built?: number;
  num_units?: number;
  lot_area_m2?: number;
  building_area_m2?: number;
  property_type?: string;
  evaluation_total?: number;
  evaluation_land?: number;
  evaluation_bldg?: number;
  evaluation_year?: number;
  raw_role_row: Record<string, unknown>;
}

export type ContactKind = "person" | "company" | "numbered_co" | "trust" | "unknown";

export interface ParsedOwner {
  kind: ContactKind;
  first_name?: string;
  last_name?: string;
  full_name: string;                       // display, denorm
  company_name?: string;
  numbered_co_id?: string;
  mailing_address?: string;
  mailing_city?: string;
  mailing_postal?: string;
  share_pct?: number;
  phones: string[];                        // E.164 list, deduped
  source_columns: { phone?: string; address?: string };

  // ─── v3 import redesign — structured mailing address ──────────────────
  /** Parsed mailing-address components. Populated by the canonical address parser. */
  mailing_civic?: string | null;
  mailing_street?: string | null;
  mailing_unit?: string | null;
  mailing_province?: string | null;
  mailing_postal_fsa?: string | null;
  /** "complete" | "missing_civic" | "missing_street" | "missing_postal" | "incoherent_city" | "unparseable" */
  mailing_parse_quality?: ContactParseQuality;

  // ─── v3 import redesign — name parser audit ────────────────────────────
  middle_names?: string[];
  /** Set when the name-parser detected (and possibly corrected) an inversion. */
  name_was_inverted?: boolean;
  /** Quality flag. "complete" = first+last detected; otherwise reason. */
  name_parse_quality?: NameParseQuality;
}

export type ContactParseQuality =
  | "complete"
  | "missing_civic"
  | "missing_street"
  | "missing_postal"
  | "incoherent_city"
  | "unparseable";

export type NameParseQuality =
  | "complete"           // first + last present, no ambiguity
  | "inverted_corrected" // we swapped first/last
  | "middle_moved"       // we moved middle name(s) to nom
  | "ambiguous"          // could be either order; left as-is
  | "single_token"       // only one word
  | "company"            // not applicable (entity owner)
  | "unparseable";

// ─── v3 import redesign — per-row audit attached to ParsedRow ──────────────

export interface ParsedRowAudit {
  row_number: number;
  /** Hard refusals — row will not be persisted. */
  blocking: string[];
  /** Warnings — surfaced in preview UI but row still imports. */
  warnings: string[];
  /** Per-owner audit fields, keyed by owner index in the row. */
  owners: Array<{
    kind: ContactKind;
    name_parse_quality: NameParseQuality | null;
    name_was_inverted: boolean;
    mailing_parse_quality: ContactParseQuality | null;
    phones_extracted: number;
    phones_rejected: number;
  }>;
}

export interface ParsedRow {
  row_number: number;                      // 1-indexed in source spreadsheet
  property: ParsedProperty;
  owners: ParsedOwner[];                   // 1..N
  errors: string[];                        // soft errors (e.g. "no city detected")
  /** v3 — per-row validation audit produced by import-validator. Optional for backward compat. */
  audit?: ParsedRowAudit;
}

export interface ParseResult {
  format: RoleFormat;
  rows: ParsedRow[];
  errors: { row: number; message: string }[]; // hard errors that prevented parsing
  total_rows: number;
  detected_columns: string[];
}
