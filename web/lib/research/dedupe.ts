/**
 * Three-stage canonical-owner deduplication.
 *
 * Stage 0 (companies only): exact match on canonical_owner.neq.
 * Stage 1 (deterministic): match on (canonical_name_normalized, mailing_postal_fsa)
 *   or on owner_alias.alias_name_normalized.
 * Stage 2 (fuzzy): same normalized name + geocode within 500m → pending_review.
 * Stage 3 (long tail): name matches but no geocode overlap → no_match (caller inserts new).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEntityName, normalizePersonName, extractFsa } from "../req/normalize";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export type OwnerType =
  | "individual"
  | "numbered_co"
  | "named_co"
  | "trust"
  | "government";

export type DedupeInput = {
  canonicalName: string;
  ownerType: OwnerType;
  neq?: string | null;
  mailingAddressRaw?: string | null;
  mailingGeocode?: { lat: number; lng: number } | null;
  mailingPostal?: string | null;
};

export type DedupeMatch =
  | { kind: "exact"; ownerId: string }
  | { kind: "fuzzy_review"; ownerId: string; reason: string }
  | { kind: "no_match" };

/**
 * Normalize a name for deduplication purposes.
 * Uses entity normalization for companies, person normalization for individuals.
 */
export function normalizeForDedupe(name: string, ownerType: OwnerType): string {
  if (ownerType === "individual") {
    return normalizePersonName(name);
  }
  return normalizeEntityName(name);
}

/**
 * Compute the great-circle distance between two lat/lng points in metres
 * using the Haversine formula.
 */
function haversineMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

/**
 * Three-stage owner deduplication.
 *
 * @param sb    A Supabase admin (or server) client.
 * @param input Normalisation inputs for the candidate owner.
 * @returns     A DedupeMatch describing the outcome.
 */
export async function dedupeOwner(
  sb: AnyClient,
  input: DedupeInput,
): Promise<DedupeMatch> {
  const isCompany =
    input.ownerType === "numbered_co" ||
    input.ownerType === "named_co";

  const normalizedName = normalizeForDedupe(input.canonicalName, input.ownerType);
  const fsa = extractFsa(input.mailingPostal ?? null);

  // ------------------------------------------------------------------
  // Stage 0: NEQ exact match (companies only)
  // ------------------------------------------------------------------
  if (isCompany && input.neq) {
    const { data: neqRow } = await sb
      .from("canonical_owner")
      .select("owner_id")
      .eq("neq", input.neq)
      .maybeSingle();

    if (neqRow) {
      return { kind: "exact", ownerId: neqRow.owner_id as string };
    }
  }

  // ------------------------------------------------------------------
  // Stage 1a: deterministic name + FSA match on canonical_owner
  // ------------------------------------------------------------------
  if (normalizedName) {
    let query = sb
      .from("canonical_owner")
      .select("owner_id")
      .eq("canonical_name_normalized", normalizedName);

    if (fsa) {
      query = query.eq("mailing_postal_fsa", fsa);
    }

    const { data: nameRows } = await query.limit(1);

    if (nameRows && nameRows.length > 0) {
      return { kind: "exact", ownerId: nameRows[0].owner_id as string };
    }

    // ------------------------------------------------------------------
    // Stage 1b: alias probe — search owner_alias.alias_name_normalized
    // ------------------------------------------------------------------
    const { data: aliasRows } = await sb
      .from("owner_alias")
      .select("owner_id")
      .eq("alias_name_normalized", normalizedName)
      .limit(1);

    if (aliasRows && aliasRows.length > 0) {
      return { kind: "exact", ownerId: aliasRows[0].owner_id as string };
    }
  }

  // ------------------------------------------------------------------
  // Stage 2: fuzzy geocode match — same normalized name, geocode ≤ 500m
  // ------------------------------------------------------------------
  if (normalizedName && input.mailingGeocode) {
    const { data: fuzzyRows } = await sb
      .from("canonical_owner")
      .select("owner_id, mailing_geocode")
      .eq("canonical_name_normalized", normalizedName)
      .not("mailing_geocode", "is", null)
      .limit(100);

    if (fuzzyRows && fuzzyRows.length > 0) {
      for (const row of fuzzyRows) {
        const geocode = row.mailing_geocode as
          | { lat: number; lng: number }
          | null;
        if (!geocode) continue;
        const dist = haversineMetres(input.mailingGeocode, geocode);
        if (dist <= 500) {
          return {
            kind: "fuzzy_review",
            ownerId: row.owner_id as string,
            reason: `Same normalized name, geocode distance ${Math.round(dist)}m ≤ 500m`,
          };
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Stage 3: long tail — no match found
  // ------------------------------------------------------------------
  return { kind: "no_match" };
}
