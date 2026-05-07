/**
 * TypeScript types mirroring the req_entities and req_directors DB tables.
 * These are used by lookup helpers and the ingest script.
 */

export interface ReqEntity {
  neq: string;
  legal_name: string;
  legal_name_normalized: string;
  juridical_form: string | null;
  status: string | null;
  status_date: string | null; // ISO date string
  registered_address_raw: string | null;
  mailing_address_raw: string | null;
  registered_geocode: unknown | null; // PostGIS geography — opaque in TS
  mailing_geocode: unknown | null;
  postal_fsa: string | null;
  registered_phone: string | null;
  activity_codes: string[] | null;
  imported_at: string; // ISO timestamptz string
}

export interface ReqDirector {
  id: string;
  neq: string;
  full_name: string;
  full_name_normalized: string;
  surname: string;
  given_name: string | null;
  role: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface ReqSnapshotMeta {
  id: number;
  imported_at: string;
  source_file: string;
  source_date: string | null;
  entity_count: number;
  director_count: number;
}
