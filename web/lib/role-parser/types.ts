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
}

export interface ParsedRow {
  row_number: number;                      // 1-indexed in source spreadsheet
  property: ParsedProperty;
  owners: ParsedOwner[];                   // 1..N
  errors: string[];                        // soft errors (e.g. "no city detected")
}

export interface ParseResult {
  format: RoleFormat;
  rows: ParsedRow[];
  errors: { row: number; message: string }[]; // hard errors that prevented parsing
  total_rows: number;
  detected_columns: string[];
}
