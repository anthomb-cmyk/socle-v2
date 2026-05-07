/**
 * REQ snapshot ingest script.
 *
 * Usage:
 *   npx tsx scripts/ingest-req.ts [--file=<path>]
 *
 * If --file is not provided, the script attempts to locate the REQ CSV via:
 *   find ~ -name '*entreprise*.csv' -type f 2>/dev/null | head -5
 *
 * Requires:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GOOGLE_GEOCODING_API_KEY  (optional; geocoding is skipped if missing)
 *
 * The script is idempotent: entities are upserted on conflict(neq), directors
 * are deleted-and-reinserted per NEQ batch.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse } from "csv-parse";
import { createClient } from "@supabase/supabase-js";
import { normalizeEntityName, normalizePersonName, extractFsa } from "../lib/req/normalize";
import { geocodeAddress } from "../lib/req/geocode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedEntity {
  neq: string;
  legal_name: string;
  legal_name_normalized: string;
  juridical_form: string | null;
  status: string | null;
  status_date: string | null;
  registered_address_raw: string | null;
  mailing_address_raw: string | null;
  postal_fsa: string | null;
  registered_phone: string | null;
  activity_codes: string[];
}

export interface ParsedDirector {
  neq: string;
  full_name: string;
  full_name_normalized: string;
  surname: string;
  given_name: string | null;
  role: string | null;
  start_date: string | null;
  end_date: string | null;
}

// ---------------------------------------------------------------------------
// Column mapping
// The REQ CSV uses French headers; we map them forgivingly (case-insensitive,
// whitespace-stripped).  Adjust the mapping array if Registraire changes headers.
// ---------------------------------------------------------------------------

const COL_MAP: Array<{ field: keyof ColumnMapping; patterns: string[] }> = [
  { field: "neq",              patterns: ["NEQ", "NO_ENTR", "NUMERO_ENTREPRISE"] },
  { field: "legal_name",       patterns: ["NOM_ASSUJ", "NOM", "DENOMINACION", "RAISON_SOCIALE"] },
  { field: "juridical_form",   patterns: ["FORME_JURI", "FORME_JURIDIQUE"] },
  { field: "status",           patterns: ["COD_STAT_IMM", "STATUT", "ETAT"] },
  { field: "status_date",      patterns: ["DAT_STAT_IMM", "DATE_STATUT", "DATE_ETAT"] },
  { field: "reg_addr_no",      patterns: ["NO_CIVIQ_DOMCL", "NO_CIVIQUE_DOM"] },
  { field: "reg_addr_street",  patterns: ["NOM_RUE_DOMCL", "NOM_RUE_DOM", "RUE_DOM"] },
  { field: "reg_addr_city",    patterns: ["NOM_MUNICIPALITE_DOMCL", "MUNICIPALITE_DOM", "VILLE_DOM"] },
  { field: "reg_addr_prov",    patterns: ["NOM_PROVINCE_DOMCL", "PROVINCE_DOM"] },
  { field: "reg_addr_postal",  patterns: ["COD_POSTAL_DOMCL", "CODE_POSTAL_DOM"] },
  { field: "mail_addr_no",     patterns: ["NO_CIVIQ_CORRESP", "NO_CIVIQUE_CORR"] },
  { field: "mail_addr_street", patterns: ["NOM_RUE_CORRESP", "NOM_RUE_CORR", "RUE_CORR"] },
  { field: "mail_addr_city",   patterns: ["NOM_MUNICIPALITE_CORRESP", "MUNICIPALITE_CORR", "VILLE_CORR"] },
  { field: "mail_addr_prov",   patterns: ["NOM_PROVINCE_CORRESP", "PROVINCE_CORR"] },
  { field: "mail_addr_postal", patterns: ["COD_POSTAL_CORRESP", "CODE_POSTAL_CORR"] },
  { field: "phone",            patterns: ["NO_TELEPH_DOMCL", "TEL_DOM", "TELEPHONE"] },
  { field: "activity_code",    patterns: ["COD_ACTV_ECON_ASSUJ", "CODE_ACTIVITE", "COD_ACTV"] },
  { field: "dir_surname",      patterns: ["NOM_ADMIN", "NOM_DIRIGEANT", "SURNAME_DIRECTOR"] },
  { field: "dir_given",        patterns: ["PRENOM_ADMIN", "PRENOM_DIRIGEANT", "GIVEN_DIRECTOR"] },
  { field: "dir_role",         patterns: ["TITRE_ADMIN", "ROLE_DIRIGEANT", "ROLE_DIRECTOR"] },
  { field: "dir_start",        patterns: ["DAT_DEBUT_ADMIN", "DATE_DEBUT_DIR"] },
  { field: "dir_end",          patterns: ["DAT_FIN_ADMIN", "DATE_FIN_DIR"] },
];

interface ColumnMapping {
  neq?: string;
  legal_name?: string;
  juridical_form?: string;
  status?: string;
  status_date?: string;
  reg_addr_no?: string;
  reg_addr_street?: string;
  reg_addr_city?: string;
  reg_addr_prov?: string;
  reg_addr_postal?: string;
  mail_addr_no?: string;
  mail_addr_street?: string;
  mail_addr_city?: string;
  mail_addr_prov?: string;
  mail_addr_postal?: string;
  phone?: string;
  activity_code?: string;
  dir_surname?: string;
  dir_given?: string;
  dir_role?: string;
  dir_start?: string;
  dir_end?: string;
}

/**
 * Resolve the actual CSV header names to our internal field names.
 * Returns a map: internalField → actualColumnName.
 */
export function resolveColumnMapping(headers: string[]): ColumnMapping {
  const normalHeader = (h: string) => h.trim().toUpperCase().replace(/\s+/g, "_");
  const normalizedHeaders = headers.map(normalHeader);

  const mapping: ColumnMapping = {};
  for (const { field, patterns } of COL_MAP) {
    for (const pattern of patterns) {
      const idx = normalizedHeaders.indexOf(pattern.toUpperCase());
      if (idx >= 0) {
        (mapping as Record<string, string>)[field] = headers[idx];
        break;
      }
    }
  }
  return mapping;
}

function buildAddress(parts: (string | undefined)[]): string | null {
  const s = parts.filter(Boolean).join(", ");
  return s.length > 0 ? s : null;
}

function parseDateField(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Accept ISO dates as-is; convert DD/MM/YYYY or YYYYMMDD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.split("/");
    return `${y}-${m}-${d}`;
  }
  return trimmed; // pass through; let the DB reject if invalid
}

/**
 * Map a raw CSV row to ParsedEntity + optional ParsedDirector.
 * Returns null for the entity if NEQ is missing.
 */
export function mapRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
): { entity: ParsedEntity | null; director: ParsedDirector | null } {
  const get = (field: keyof ColumnMapping): string | undefined => {
    const col = mapping[field];
    return col ? row[col]?.trim() : undefined;
  };

  const neq = get("neq");
  if (!neq) return { entity: null, director: null };

  const legal_name = get("legal_name") ?? neq;

  const reg_addr = buildAddress([
    get("reg_addr_no"),
    get("reg_addr_street"),
    get("reg_addr_city"),
    get("reg_addr_prov"),
    get("reg_addr_postal"),
  ]);

  const mail_addr = buildAddress([
    get("mail_addr_no"),
    get("mail_addr_street"),
    get("mail_addr_city"),
    get("mail_addr_prov"),
    get("mail_addr_postal"),
  ]);

  const postalRaw = get("mail_addr_postal") ?? get("reg_addr_postal");

  const activityRaw = get("activity_code");
  const activity_codes = activityRaw
    ? activityRaw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const entity: ParsedEntity = {
    neq,
    legal_name,
    legal_name_normalized: normalizeEntityName(legal_name),
    juridical_form: get("juridical_form") ?? null,
    status: get("status") ?? null,
    status_date: parseDateField(get("status_date")),
    registered_address_raw: reg_addr,
    mailing_address_raw: mail_addr,
    postal_fsa: extractFsa(postalRaw),
    registered_phone: get("phone") ?? null,
    activity_codes,
  };

  // Director (optional — only emit if surname present)
  const surname = get("dir_surname");
  let director: ParsedDirector | null = null;
  if (surname) {
    const givenName = get("dir_given") ?? null;
    const full_name = [givenName, surname].filter(Boolean).join(" ");
    director = {
      neq,
      full_name,
      full_name_normalized: normalizePersonName(full_name),
      surname,
      given_name: givenName,
      role: get("dir_role") ?? null,
      start_date: parseDateField(get("dir_start")),
      end_date: parseDateField(get("dir_end")),
    };
  }

  return { entity, director };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findCsvFile(): string | null {
  try {
    const result = execSync(
      "find ~ -name '*entreprise*.csv' -type f 2>/dev/null | head -5",
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();
    const lines = result.split("\n").filter(Boolean);
    return lines[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main ingest
// ---------------------------------------------------------------------------

const BATCH_SIZE = 1000;

async function main() {
  // Parse --file= argument
  const fileArg = process.argv
    .slice(2)
    .find((a) => a.startsWith("--file="))
    ?.replace("--file=", "");

  const csvPath = fileArg ?? findCsvFile();

  if (!csvPath) {
    console.error(
      "ERROR: No REQ CSV file found. " +
        "Provide one via --file=<path> or ensure a '*entreprise*.csv' file exists under ~/.",
    );
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`ERROR: File not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`[ingest-req] Using file: ${csvPath}`);

  // Create Supabase admin client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const hasGeoKey = Boolean(process.env.GOOGLE_GEOCODING_API_KEY);
  if (!hasGeoKey) {
    console.warn("[ingest-req] GOOGLE_GEOCODING_API_KEY not set — geocoding will be skipped.");
  }

  // Stream CSV
  const parser = fs.createReadStream(csvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }),
  );

  let mapping: ColumnMapping | null = null;
  const entityBatch: ParsedEntity[] = [];
  const directorBatch: ParsedDirector[] = [];
  let totalEntities = 0;
  let totalDirectors = 0;

  const flushEntities = async () => {
    if (entityBatch.length === 0) return;

    // Optionally geocode
    const toInsert = await Promise.all(
      entityBatch.map(async (e) => {
        let registered_geocode: string | null = null;
        let mailing_geocode: string | null = null;

        if (hasGeoKey) {
          if (e.registered_address_raw) {
            const g = await geocodeAddress(e.registered_address_raw, true);
            if (g) registered_geocode = `POINT(${g.lng} ${g.lat})`;
          }
          if (e.mailing_address_raw) {
            const g = await geocodeAddress(e.mailing_address_raw, true);
            if (g) mailing_geocode = `POINT(${g.lng} ${g.lat})`;
          }
        }

        return {
          ...e,
          registered_geocode,
          mailing_geocode,
        };
      }),
    );

    const { error } = await sb
      .from("req_entities")
      .upsert(toInsert, { onConflict: "neq" });

    if (error) {
      console.error("[ingest-req] Entity upsert error:", error.message);
    } else {
      totalEntities += entityBatch.length;
      console.log(`[ingest-req] Upserted ${totalEntities} entities so far…`);
    }
    entityBatch.length = 0;
  };

  const flushDirectors = async () => {
    if (directorBatch.length === 0) return;

    const { error } = await sb.from("req_directors").upsert(directorBatch, {
      onConflict: "id",
    });

    if (error) {
      console.error("[ingest-req] Director insert error:", error.message);
    } else {
      totalDirectors += directorBatch.length;
    }
    directorBatch.length = 0;
  };

  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    // Resolve column mapping from the first row's keys
    if (!mapping) {
      mapping = resolveColumnMapping(Object.keys(row));
      console.log("[ingest-req] Column mapping resolved:", mapping);
    }

    const { entity, director } = mapRow(row, mapping);
    if (!entity) continue;

    entityBatch.push(entity);
    if (director) directorBatch.push(director);

    if (entityBatch.length >= BATCH_SIZE) {
      await flushEntities();
    }
    if (directorBatch.length >= BATCH_SIZE) {
      await flushDirectors();
    }
  }

  // Flush remaining
  await flushEntities();
  await flushDirectors();

  // Write snapshot meta
  const sourceDate = new Date().toISOString().slice(0, 10);
  await sb.from("req_snapshot_meta").insert({
    source_file: path.basename(csvPath),
    source_date: sourceDate,
    entity_count: totalEntities,
    director_count: totalDirectors,
  });

  console.log(
    `[ingest-req] Done. Entities: ${totalEntities}, Directors: ${totalDirectors}`,
  );
}

// Only run when executed directly (not imported in tests)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace("file://", ""))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
