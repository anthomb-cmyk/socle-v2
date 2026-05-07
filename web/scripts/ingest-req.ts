/**
 * REQ snapshot ingest script.
 *
 * Usage:
 *   npx tsx scripts/ingest-req.ts [--file=<path>]
 *   npx tsx scripts/ingest-req.ts --names-file=<Nom.csv>
 *   npx tsx scripts/ingest-req.ts --addresses-file=<Etablissements.csv>
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

/**
 * Represents a resolved name from Nom.csv.
 * `isCurrent` indicates this is the active legal name (DAT_FIN_NOM_ASSUJ is null/empty).
 */
export interface ParsedNomRow {
  neq: string;
  name: string;
  aliasType: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

/**
 * Result of processing a set of Nom.csv rows for a single NEQ:
 * the chosen current name and any aliases.
 */
export interface ResolvedEntityName {
  neq: string;
  currentName: string;
  aliases: Array<{
    name: string;
    aliasType: string | null;
    startDate: string | null;
    endDate: string | null;
  }>;
}

/**
 * Represents a row from Etablissements.csv after filtering to principal establishments.
 */
export interface ParsedEtabRow {
  neq: string;
  addressRaw: string;
}

// ---------------------------------------------------------------------------
// Column mapping — Entreprise.csv
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

export function parseDateField(raw: string | undefined): string | null {
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
// Nom.csv parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a single Nom.csv row into a ParsedNomRow.
 * Returns null if NEQ or name is missing.
 *
 * Nom.csv header: NEQ,NOM_ASSUJ,NOM_ASSUJ_LANG_ETRNG,STAT_NOM,TYP_NOM_ASSUJ,
 *                 DAT_INIT_NOM_ASSUJ,DAT_FIN_NOM_ASSUJ
 */
export function parseNomRow(row: Record<string, string>): ParsedNomRow | null {
  const neq = row["NEQ"]?.trim();
  const name = row["NOM_ASSUJ"]?.trim();
  if (!neq || !name) return null;

  const endDateRaw = row["DAT_FIN_NOM_ASSUJ"]?.trim() ?? "";
  const isCurrent = endDateRaw === "" || endDateRaw === null;

  return {
    neq,
    name,
    aliasType: row["TYP_NOM_ASSUJ"]?.trim() || null,
    startDate: parseDateField(row["DAT_INIT_NOM_ASSUJ"]),
    endDate: parseDateField(row["DAT_FIN_NOM_ASSUJ"]),
    isCurrent,
  };
}

/**
 * Given a list of ParsedNomRow for a single NEQ, pick the current name
 * and collect aliases.
 *
 * Current name selection priority:
 *   1. Rows where isCurrent=true (DAT_FIN_NOM_ASSUJ is null/empty)
 *      — if multiple, pick the one with latest DAT_INIT_NOM_ASSUJ
 *   2. If none are current, pick the row with latest DAT_INIT_NOM_ASSUJ
 */
export function resolveCurrentName(rows: ParsedNomRow[]): ResolvedEntityName | null {
  if (rows.length === 0) return null;

  const neq = rows[0].neq;
  const currentRows = rows.filter((r) => r.isCurrent);
  const candidates = currentRows.length > 0 ? currentRows : rows;

  // Sort by startDate descending (null dates sort last)
  const sorted = [...candidates].sort((a, b) => {
    if (!a.startDate && !b.startDate) return 0;
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return b.startDate.localeCompare(a.startDate);
  });

  const chosen = sorted[0];
  const aliases = rows
    .filter((r) => r !== chosen)
    .map((r) => ({
      name: r.name,
      aliasType: r.aliasType,
      startDate: r.startDate,
      endDate: r.endDate,
    }));

  return { neq, currentName: chosen.name, aliases };
}

// ---------------------------------------------------------------------------
// Etablissements.csv parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a single Etablissements.csv row.
 * Returns null if not the principal establishment or if NEQ/address is missing.
 *
 * Etablissements.csv header:
 *   NEQ,NO_SUF_ETAB,IND_ETAB_PRINC,IND_SALON_BRONZ,IND_VENTE_TABAC_DETL,IND_DISP,
 *   LIGN1_ADR,LIGN2_ADR,LIGN3_ADR,LIGN4_ADR,COD_ACT_ECON,DESC_ACT_ECON_ETAB,...,NOM_ETAB
 */
export function parseEtabRow(row: Record<string, string>): ParsedEtabRow | null {
  const neq = row["NEQ"]?.trim();
  const isPrincipal = row["IND_ETAB_PRINC"]?.trim();
  if (!neq || isPrincipal !== "1") return null;

  const lines = [
    row["LIGN1_ADR"]?.trim(),
    row["LIGN2_ADR"]?.trim(),
    row["LIGN3_ADR"]?.trim(),
    row["LIGN4_ADR"]?.trim(),
  ].filter(Boolean);

  if (lines.length === 0) return null;

  return {
    neq,
    addressRaw: lines.join(", "),
  };
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
// Main ingest — Entreprise.csv
// ---------------------------------------------------------------------------

const BATCH_SIZE = 1000;
const PROGRESS_INTERVAL = 50_000;

async function ingestEntrepriseFile(csvPath: string) {
  console.log(`[ingest-req] Using file: ${csvPath}`);

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

  const parser = fs.createReadStream(csvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }),
  );

  let mapping: ColumnMapping | null = null;
  const entityBatch: ParsedEntity[] = [];
  const directorBatch: ParsedDirector[] = [];
  let totalEntities = 0;
  let totalDirectors = 0;
  let rowsRead = 0;

  const flushEntities = async () => {
    if (entityBatch.length === 0) return;

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
      if (totalEntities % PROGRESS_INTERVAL < BATCH_SIZE) {
        console.log(`[ingest-req] Upserted ${totalEntities} entities so far…`);
      }
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
    rowsRead++;
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

    if (rowsRead % PROGRESS_INTERVAL === 0) {
      console.log(`[ingest-req] Read ${rowsRead} rows…`);
    }
  }

  await flushEntities();
  await flushDirectors();

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

// ---------------------------------------------------------------------------
// Nom.csv ingest
// ---------------------------------------------------------------------------

async function ingestNamesFile(csvPath: string) {
  console.log(`[ingest-req] --names-file mode: ${csvPath}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const parser = fs.createReadStream(csvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }),
  );

  // Accumulate rows per NEQ in a map; flush when map hits BATCH_SIZE distinct NEQs
  const neqMap = new Map<string, ParsedNomRow[]>();
  let totalRowsRead = 0;
  let totalEntitiesUpdated = 0;
  let totalAliasesInserted = 0;

  const flushNomBatch = async (batch: Map<string, ParsedNomRow[]>) => {
    if (batch.size === 0) return;

    const entityUpdates: Array<{ neq: string; legal_name: string; legal_name_normalized: string }> = [];
    const aliasInserts: Array<{
      neq: string;
      alias_name: string;
      alias_name_normalized: string;
      alias_type: string | null;
      start_date: string | null;
      end_date: string | null;
    }> = [];

    for (const [, rows] of batch) {
      const resolved = resolveCurrentName(rows);
      if (!resolved) continue;

      entityUpdates.push({
        neq: resolved.neq,
        legal_name: resolved.currentName,
        legal_name_normalized: normalizeEntityName(resolved.currentName),
      });

      for (const alias of resolved.aliases) {
        aliasInserts.push({
          neq: resolved.neq,
          alias_name: alias.name,
          alias_name_normalized: normalizeEntityName(alias.name),
          alias_type: alias.aliasType,
          start_date: alias.startDate,
          end_date: alias.endDate,
        });
      }
    }

    if (entityUpdates.length > 0) {
      const { error } = await sb
        .from("req_entities")
        .upsert(entityUpdates, { onConflict: "neq" });
      if (error) {
        console.error("[ingest-req] Name update error:", error.message);
      } else {
        totalEntitiesUpdated += entityUpdates.length;
      }
    }

    if (aliasInserts.length > 0) {
      // Insert aliases in sub-batches to avoid payload limits
      const SUB_BATCH = 500;
      for (let i = 0; i < aliasInserts.length; i += SUB_BATCH) {
        const chunk = aliasInserts.slice(i, i + SUB_BATCH);
        const { error } = await sb
          .from("req_entity_alias")
          .upsert(chunk, { onConflict: "neq,alias_name_normalized", ignoreDuplicates: true });
        if (error) {
          // Fall back to insert ignoring duplicates at app level
          for (const row of chunk) {
            const { error: e2 } = await sb
              .from("req_entity_alias")
              .insert(row);
            if (e2 && !e2.message.includes("duplicate")) {
              console.warn("[ingest-req] Alias insert warning:", e2.message);
            }
          }
        } else {
          totalAliasesInserted += chunk.length;
        }
      }
    }
  };

  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    totalRowsRead++;
    const parsed = parseNomRow(row);
    if (!parsed) continue;

    const existing = neqMap.get(parsed.neq) ?? [];
    existing.push(parsed);
    neqMap.set(parsed.neq, existing);

    // Flush when we have BATCH_SIZE distinct NEQs
    if (neqMap.size >= BATCH_SIZE) {
      await flushNomBatch(neqMap);
      neqMap.clear();
    }

    if (totalRowsRead % PROGRESS_INTERVAL === 0) {
      console.log(
        `[ingest-req] Nom.csv: read ${totalRowsRead} rows, ` +
        `updated ${totalEntitiesUpdated} entities, ${totalAliasesInserted} aliases so far…`,
      );
    }
  }

  // Flush remainder
  await flushNomBatch(neqMap);
  neqMap.clear();

  console.log(
    `[ingest-req] Nom.csv done. Rows read: ${totalRowsRead}, ` +
    `entities updated: ${totalEntitiesUpdated}, aliases inserted: ${totalAliasesInserted}`,
  );
}

// ---------------------------------------------------------------------------
// Etablissements.csv ingest
// ---------------------------------------------------------------------------

async function ingestAddressesFile(csvPath: string) {
  console.log(`[ingest-req] --addresses-file mode: ${csvPath}`);

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

  const parser = fs.createReadStream(csvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }),
  );

  let totalRowsRead = 0;
  let totalUpdated = 0;
  const batch: ParsedEtabRow[] = [];

  const flushAddressBatch = async (rows: ParsedEtabRow[]) => {
    if (rows.length === 0) return;

    const updates = await Promise.all(
      rows.map(async (r) => {
        const postal_fsa = extractFsa(r.addressRaw);
        let registered_geocode: string | null = null;

        if (hasGeoKey) {
          const g = await geocodeAddress(r.addressRaw, true);
          if (g) {
            registered_geocode = `POINT(${g.lng} ${g.lat})`;
          }
        }

        return {
          neq: r.neq,
          registered_address_raw: r.addressRaw,
          postal_fsa,
          registered_geocode,
        };
      }),
    );

    const { error } = await sb
      .from("req_entities")
      .upsert(updates, { onConflict: "neq" });

    if (error) {
      console.error("[ingest-req] Address upsert error:", error.message);
    } else {
      totalUpdated += updates.length;
    }
  };

  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    totalRowsRead++;
    const parsed = parseEtabRow(row);
    if (!parsed) continue;

    batch.push(parsed);

    if (batch.length >= BATCH_SIZE) {
      await flushAddressBatch(batch);
      batch.length = 0;
    }

    if (totalRowsRead % PROGRESS_INTERVAL === 0) {
      console.log(
        `[ingest-req] Etablissements.csv: read ${totalRowsRead} rows, updated ${totalUpdated} entities so far…`,
      );
    }
  }

  await flushAddressBatch(batch);
  batch.length = 0;

  console.log(
    `[ingest-req] Etablissements.csv done. Rows read: ${totalRowsRead}, entities updated: ${totalUpdated}`,
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const namesArg = args.find((a) => a.startsWith("--names-file="))?.replace("--names-file=", "");
  const addressesArg = args.find((a) => a.startsWith("--addresses-file="))?.replace("--addresses-file=", "");
  const fileArg = args.find((a) => a.startsWith("--file="))?.replace("--file=", "");

  if (namesArg) {
    if (!fs.existsSync(namesArg)) {
      console.error(`ERROR: File not found: ${namesArg}`);
      process.exit(1);
    }
    await ingestNamesFile(namesArg);
    return;
  }

  if (addressesArg) {
    if (!fs.existsSync(addressesArg)) {
      console.error(`ERROR: File not found: ${addressesArg}`);
      process.exit(1);
    }
    await ingestAddressesFile(addressesArg);
    return;
  }

  // Default: Entreprise.csv mode
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

  await ingestEntrepriseFile(csvPath);
}

// Only run when executed directly (not imported in tests).
// Use fileURLToPath to handle URL-encoded paths (e.g. spaces → %20).
import { fileURLToPath } from "node:url";
const __thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__thisFile)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
