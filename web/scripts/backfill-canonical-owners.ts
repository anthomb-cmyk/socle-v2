/**
 * backfill-canonical-owners.ts
 *
 * Iterates the existing `contacts` table and derives canonical_owner,
 * owner_alias, and raw_property rows.
 *
 * Two geocoding modes:
 *   1. LIVE: when GOOGLE_GEOCODING_API_KEY is present, geocodes each
 *      mailing_address and stores the result in mailing_geocode.
 *   2. SKIP-GEOCODE FALLBACK: when no API key is available, mailing_geocode
 *      is set to NULL. Deduplication still works for Stage 0 (NEQ) and
 *      Stage 1 (name + FSA), but Stage 2 fuzzy geocode matching is disabled.
 *      This is the expected mode in CI / sandbox environments.
 *
 * Idempotent: safe to re-run. Uses ON CONFLICT DO NOTHING for all inserts.
 *
 * Usage:
 *   npx tsx web/scripts/backfill-canonical-owners.ts
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeEntityName, normalizePersonName, extractFsa } from "../lib/req/normalize";
import { geocodeAddress } from "../lib/req/geocode";
import { dedupeOwner, type OwnerType, type DedupeInput } from "../lib/research/dedupe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContactRow {
  id: string;
  kind: "person" | "company" | "numbered_co" | "trust" | "unknown";
  full_name: string | null;
  company_name: string | null;
  numbered_co_id: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_province: string | null;
  mailing_postal: string | null;
}

interface PropertyContactRow {
  contact_id: string;
  property_id: string;
  source_import_job_id: string | null;
}

interface PropertyRow {
  id: string;
  matricule: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map contact_kind enum values to canonical OwnerType.
 *
 * Mapping:
 *   person       → individual
 *   numbered_co  → numbered_co
 *   company      → named_co   (has letters in name) or numbered_co (leading digits only)
 *   trust        → trust
 *   unknown      → individual (safest default)
 */
export function classifyOwnerType(
  kind: ContactRow["kind"],
  name: string | null,
): OwnerType {
  switch (kind) {
    case "person":
      return "individual";
    case "numbered_co":
      return "numbered_co";
    case "trust":
      return "trust";
    case "company": {
      // Numbered company if name starts with digits (e.g. "9123-4567 Québec Inc")
      if (name && /^\d/.test(name.trim())) {
        return "numbered_co";
      }
      return "named_co";
    }
    case "unknown":
    default:
      return "individual";
  }
}

/**
 * Derive the canonical display name for a contact.
 * Companies use company_name (or full_name as fallback).
 * People use full_name.
 */
export function deriveCanonicalName(contact: ContactRow): string {
  if (contact.kind === "person" || contact.kind === "unknown") {
    return contact.full_name ?? "";
  }
  return contact.company_name ?? contact.full_name ?? "";
}

/**
 * Normalize a canonical name according to owner type.
 */
export function normalizeCanonicalName(
  name: string,
  ownerType: OwnerType,
): string {
  if (ownerType === "individual") {
    return normalizePersonName(name);
  }
  return normalizeEntityName(name);
}

/**
 * Build a full mailing address string for geocoding.
 */
function buildMailingAddressString(contact: ContactRow): string | null {
  const parts = [
    contact.mailing_address,
    contact.mailing_city,
    contact.mailing_province,
    contact.mailing_postal,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Supabase client factory
// ---------------------------------------------------------------------------

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Main backfill
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;

export async function runBackfill(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: ReturnType<typeof createClient<any>>,
  opts: { dryRun?: boolean } = {},
): Promise<{
  canonicalOwnersInserted: number;
  aliasesInserted: number;
  rawPropertiesInserted: number;
  contactsProcessed: number;
}> {
  let canonicalOwnersInserted = 0;
  let aliasesInserted = 0;
  let rawPropertiesInserted = 0;
  let contactsProcessed = 0;
  let offset = 0;
  const hasGeoKey = Boolean(process.env.GOOGLE_GEOCODING_API_KEY);

  if (!hasGeoKey) {
    console.log(
      "[backfill] GOOGLE_GEOCODING_API_KEY not set — running in skip-geocode-fallback mode.",
    );
    console.log(
      "[backfill] mailing_geocode will be NULL; Stage 2 fuzzy geocode deduplication disabled.",
    );
  }

  // Preload all property_contacts and properties for the join (small dataset).
  // Using .limit(50000) as a terminal call so the query resolves correctly
  // whether running against the real Supabase client or a mock chain.
  const { data: allPc } = await sb
    .from("property_contacts")
    .select("contact_id, property_id, source_import_job_id")
    .limit(50000);
  const { data: allProps } = await sb
    .from("properties")
    .select("id, matricule")
    .limit(50000);

  const pcByContact = new Map<string, PropertyContactRow[]>();
  for (const pc of (allPc ?? []) as PropertyContactRow[]) {
    const arr = pcByContact.get(pc.contact_id) ?? [];
    arr.push(pc);
    pcByContact.set(pc.contact_id, arr);
  }

  const propById = new Map<string, PropertyRow>();
  for (const p of (allProps ?? []) as PropertyRow[]) {
    propById.set(p.id, p);
  }

  // Paginate contacts
  while (true) {
    const { data: contacts, error } = await sb
      .from("contacts")
      .select(
        "id, kind, full_name, company_name, numbered_co_id, mailing_address, mailing_city, mailing_province, mailing_postal",
      )
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("[backfill] Error fetching contacts:", error);
      break;
    }
    if (!contacts || contacts.length === 0) break;

    console.log(
      `[backfill] Processing batch offset=${offset}, count=${contacts.length}`,
    );

    for (const contact of contacts as ContactRow[]) {
      const ownerType = classifyOwnerType(contact.kind, contact.company_name ?? contact.full_name);
      const canonicalName = deriveCanonicalName(contact);
      if (!canonicalName) {
        console.warn(`[backfill] Skipping contact ${contact.id}: no name`);
        continue;
      }

      const normalizedName = normalizeCanonicalName(canonicalName, ownerType);
      const fsa = extractFsa(contact.mailing_postal);

      // Geocode (live or skip)
      let geocode: { lat: number; lng: number } | null = null;
      if (hasGeoKey) {
        const addressStr = buildMailingAddressString(contact);
        if (addressStr) {
          try {
            geocode = await geocodeAddress(addressStr, true);
          } catch {
            geocode = null;
          }
        }
      }

      const input: DedupeInput = {
        canonicalName,
        ownerType,
        neq: contact.numbered_co_id ?? null,
        mailingAddressRaw: buildMailingAddressString(contact),
        mailingGeocode: geocode,
        mailingPostal: contact.mailing_postal,
      };

      const match = await dedupeOwner(sb as never, input);

      let ownerId: string;

      if (match.kind === "exact") {
        // Owner exists — just ensure alias is present
        ownerId = match.ownerId;
      } else {
        // Insert new canonical_owner row
        const newOwner = {
          owner_type: ownerType,
          canonical_name: canonicalName,
          canonical_name_normalized: normalizedName,
          neq: contact.numbered_co_id ?? null,
          mailing_address_raw: buildMailingAddressString(contact),
          mailing_geocode: geocode
            ? `POINT(${geocode.lng} ${geocode.lat})`
            : null,
          mailing_postal_fsa: fsa,
          dedupe_status:
            match.kind === "fuzzy_review" ? "pending_review" : "auto",
          is_aggregator_address: false,
        };

        if (!opts.dryRun) {
          const { data: insertedOwner, error: ownerErr } = await sb
            .from("canonical_owner")
            .insert(newOwner)
            .select("owner_id")
            .single();

          if (ownerErr || !insertedOwner) {
            console.error(
              `[backfill] Failed to insert canonical_owner for contact ${contact.id}:`,
              ownerErr,
            );
            continue;
          }
          ownerId = insertedOwner.owner_id as string;
          canonicalOwnersInserted++;
        } else {
          ownerId = "dry-run";
          canonicalOwnersInserted++;
        }
      }

      // Insert alias (idempotent: ON CONFLICT DO NOTHING on alias_name_normalized + owner_id)
      if (!opts.dryRun && ownerId !== "dry-run") {
        const { error: aliasErr } = await sb.from("owner_alias").insert({
          owner_id: ownerId,
          alias_name: canonicalName,
          alias_name_normalized: normalizedName,
          source: "crm_backfill",
        }).select("id").limit(1);
        // Ignore conflict errors (alias already exists)
        if (aliasErr && !aliasErr.message?.includes("duplicate")) {
          console.warn(
            `[backfill] Alias insert warning for owner ${ownerId}:`,
            aliasErr.message,
          );
        } else if (!aliasErr) {
          aliasesInserted++;
        }
      } else if (opts.dryRun) {
        aliasesInserted++;
      }

      // Insert raw_property rows for each linked property
      const linkedPcs = pcByContact.get(contact.id) ?? [];
      for (const pc of linkedPcs) {
        const prop = propById.get(pc.property_id);
        if (!prop?.matricule) continue;

        const importJobId = pc.source_import_job_id ?? null;
        const sourceFileHash = importJobId
          ? `legacy_${importJobId}`
          : "legacy_unknown";

        if (!opts.dryRun) {
          const { error: rpErr } = await sb.from("raw_property").insert({
            matricule: prop.matricule,
            source_file_hash: sourceFileHash,
            source_import_job_id: importJobId,
            raw_row: { contact_id: contact.id, property_id: pc.property_id },
          }).select("id").limit(1);
          if (rpErr && !rpErr.message?.includes("duplicate")) {
            console.warn(
              `[backfill] raw_property insert warning for matricule ${prop.matricule}:`,
              rpErr.message,
            );
          } else if (!rpErr) {
            rawPropertiesInserted++;
          }
        } else {
          rawPropertiesInserted++;
        }
      }

      contactsProcessed++;
    }

    console.log(
      `[backfill] Batch done. canonicalOwners=${canonicalOwnersInserted}, aliases=${aliasesInserted}, rawProperties=${rawPropertiesInserted}`,
    );

    if (contacts.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return {
    canonicalOwnersInserted,
    aliasesInserted,
    rawPropertiesInserted,
    contactsProcessed,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

// Only run when executed directly (not when imported in tests)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfill-canonical-owners.ts");

if (isMain) {
  const sb = makeAdminClient();
  runBackfill(sb)
    .then((counts) => {
      console.log("\n[backfill] Complete.");
      console.log(`  Contacts processed  : ${counts.contactsProcessed}`);
      console.log(`  canonical_owner rows: ${counts.canonicalOwnersInserted}`);
      console.log(`  owner_alias rows    : ${counts.aliasesInserted}`);
      console.log(`  raw_property rows   : ${counts.rawPropertiesInserted}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[backfill] Fatal error:", err);
      process.exit(1);
    });
}
