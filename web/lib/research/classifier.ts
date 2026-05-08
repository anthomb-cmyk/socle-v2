/**
 * classifier.ts — Routing classifier for canonical_owner research pipeline.
 *
 * Determines whether a given owner should be researched via:
 *   Pipeline A — direct entity linkage (company or identified individual)
 *   Pipeline B — broader search (individual without clear entity link, or aggregator address)
 *
 * ## Matching flow for individuals (name-first with lazy geocode tiebreaker)
 *
 *   1. Director-name lookup — search req_directors.full_name_normalized.
 *      If matches found, try to correlate with owner address using lazy geocoding
 *      of the entity's registered_address (capped at MAX_GEOCODE_CANDIDATES = 5
 *      to bound Google API calls).
 *
 *   2. Geocode lookup — only fires if:
 *        a. The owner's mailing_geocode is already set (pre-existing value), OR
 *        b. The owner has a mailing_address_raw and we lazily geocode it via
 *           getOrFetchGeocode (writes the geocode back so future calls are free).
 *      Then calls findEntitiesByGeocode(sb, lat, lng, 75).
 *      Results are interpreted exactly as before:
 *        - 1 entity + name/director link → Pipeline A
 *        - 1 entity + no link → Pipeline B (low density, no link)
 *        - > 10 entities → Pipeline B (aggregator address)
 *        - 2–10 → fall through to director check
 *
 *   3. If neither branch produces a decision, return Pipeline B.
 *
 * ## Geocode API budget
 *   - canonical_owner.mailing_geocode: 1 call per owner the first time (then cached in DB).
 *   - req_entities.registered_geocode: at most MAX_GEOCODE_CANDIDATES calls per
 *     classification run, only when we already have a small name-matched candidate set.
 *
 * ## Graceful degradation
 *   - If the PostGIS RPC is unavailable, findEntitiesByGeocode errors are caught
 *     and treated as an empty result. The classifier returns a valid RoutingDecision.
 *   - If getOrFetchGeocode returns null (no API key, timeout, blank address), the
 *     geocode branch is skipped and execution falls through to the director-name result.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReqEntity } from "../req/types";
import {
  findEntitiesByGeocode,
  findEntitiesByName,
  findEntitiesByDirector,
} from "../req/lookup";
import { normalizePersonName } from "../req/normalize";
import { getOrFetchGeocode, getOrFetchEntityGeocode } from "../req/geocode";
import type { LatLng } from "../req/geocode";
import { findCanonicalOwnerById } from "./db";

export type { ReqEntity };

export interface RoutingDecision {
  pipeline: "A" | "B";
  primaryTarget?: ReqEntity;
  candidateTargets?: ReqEntity[]; // up to 3, ranked
  reqEnrichment?: { isDirector: boolean; directorOf: ReqEntity[] };
  isAggregator: boolean;
  reason: string;
}

/**
 * Maximum number of candidate entities we will lazily geocode in a single
 * classification run. Keeps Google API costs bounded.
 */
const MAX_GEOCODE_CANDIDATES = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Attempt geocode lookup; return empty array on any error.
 * Documents graceful-degradation choice: if the RPC does not exist or returns
 * a Postgres error, we fall back to [] so the caller can continue with
 * director-name lookup only. This is preferable to throwing because:
 *  - The migration may not yet be deployed on the current branch.
 *  - Callers should still produce a routing decision, just a less-specific one.
 */
async function safeGeocodeLookup(
  sb: SupabaseClient,
  lat: number,
  lng: number,
): Promise<ReqEntity[]> {
  try {
    return await findEntitiesByGeocode(sb, lat, lng, 75);
  } catch {
    // RPC not available or other PostGIS error — graceful fallback.
    return [];
  }
}

/**
 * Extract {lat, lng} from an existing geocode column value already loaded
 * from the DB (a PostGIS GeoJSON Point: { coordinates: [lng, lat] }).
 * Returns null if the value is missing or not a valid GeoJSON point.
 */
function parseStoredGeocode(
  value: unknown,
): LatLng | null {
  if (!value) return null;
  const geo = value as { coordinates?: [number, number] };
  if (Array.isArray(geo.coordinates) && geo.coordinates.length >= 2) {
    const [lng, lat] = geo.coordinates;
    return { lat, lng };
  }
  return null;
}

/**
 * Shared token-overlap check: does the owner's normalized name share at least
 * one token (word) with the entity's normalized legal name?
 */
function sharesToken(ownerNormalized: string, entityNormalized: string): boolean {
  const ownerTokens = new Set(ownerNormalized.split(" ").filter(Boolean));
  const entityTokens = entityNormalized.split(" ").filter(Boolean);
  return entityTokens.some((t) => ownerTokens.has(t));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Route a canonical_owner to Pipeline A or Pipeline B.
 *
 * @param sb       Supabase client (admin or server).
 * @param ownerId  UUID of the canonical_owner row.
 * @throws         If the owner row is not found.
 */
export async function routeOwner(
  sb: SupabaseClient,
  ownerId: string,
): Promise<RoutingDecision> {
  // 1. Load canonical_owner row
  const { data: owner, error } = await findCanonicalOwnerById(sb, ownerId);
  if (error || !owner) {
    throw new Error(
      `canonical_owner not found: ${ownerId}${error ? ` (${(error as Error).message ?? JSON.stringify(error)})` : ""}`,
    );
  }

  // 2. Company-type owners → Pipeline A
  const companyTypes = ["numbered_co", "named_co", "trust", "government"] as const;
  if ((companyTypes as readonly string[]).includes(owner.owner_type)) {
    let primaryTarget: ReqEntity | undefined;
    let candidateTargets: ReqEntity[] | undefined;

    if (owner.neq) {
      // Direct NEQ lookup
      const { data: rows } = await sb
        .from("req_entities")
        .select("*")
        .eq("neq", owner.neq)
        .limit(1);
      primaryTarget = rows?.[0] as ReqEntity | undefined;
    } else {
      // Name-based lookup
      const matches = await findEntitiesByName(sb, owner.canonical_name_normalized);
      if (matches.length > 0) {
        primaryTarget = matches[0];
        if (matches.length > 1) {
          candidateTargets = matches.slice(1, 4); // up to 3 additional
        }
      }
    }

    return {
      pipeline: "A",
      primaryTarget,
      candidateTargets,
      isAggregator: false,
      reason: "company owner",
    };
  }

  // 3. Individual owner — name-first with lazy geocode tiebreaker
  if (owner.owner_type === "individual") {
    const normalizedPersonName = normalizePersonName(owner.canonical_name);

    // ---- Step 3a: Director-name lookup (name-first) ----
    const directorMatches = await findEntitiesByDirector(sb, normalizedPersonName);

    // ---- Step 3b: Resolve owner geocode (lazy if needed) ----
    // Try existing column first; if null and we have a raw address, call Google.
    let ownerLatLng: LatLng | null = parseStoredGeocode(owner.mailing_geocode);

    if (!ownerLatLng && owner.mailing_address_raw) {
      ownerLatLng = await getOrFetchGeocode(
        sb,
        "canonical_owner",
        "owner_id",
        ownerId,
        owner.mailing_address_raw,
        "mailing_geocode",
      );
    }

    // ---- Step 3c: Geocode-based radius lookup ----
    if (ownerLatLng) {
      const nearbyEntities = await safeGeocodeLookup(sb, ownerLatLng.lat, ownerLatLng.lng);

      // 3c-i. Exactly 1 entity AND name/director link → Pipeline A
      if (nearbyEntities.length === 1) {
        const entity = nearbyEntities[0];
        const isDirector = directorMatches.some((d) => d.entity.neq === entity.neq);
        const nameLink = sharesToken(normalizedPersonName, entity.legal_name_normalized);

        if (isDirector || nameLink) {
          const directorOf = directorMatches.map((d) => d.entity);
          return {
            pipeline: "A",
            primaryTarget: entity,
            reqEnrichment: { isDirector, directorOf },
            isAggregator: false,
            reason: isDirector
              ? "individual at single-entity address, confirmed director"
              : "individual at single-entity address, name token match",
          };
        }
        // Single entity but no link → Pipeline B
        return {
          pipeline: "B",
          isAggregator: false,
          reason: "individual at low-density address, no name link",
        };
      }

      // 3c-ii. More than 10 entities → aggregator address → Pipeline B
      if (nearbyEntities.length > 10) {
        return {
          pipeline: "B",
          isAggregator: true,
          reason: `individual at aggregator address (${nearbyEntities.length} entities within 75 m)`,
        };
      }

      // 3c-iii. 2–10 entities — fall through; director check below acts as tiebreaker.
      //         Lazily geocode up to MAX_GEOCODE_CANDIDATES of the nearby set to
      //         confirm proximity to the owner. (Currently the director branch below
      //         handles this; the geocoded addresses could be used for distance scoring
      //         in a future enhancement.)
    }

    // ---- Step 3d: Director matches are the primary result when geocode doesn't decide ----
    if (directorMatches.length > 0) {
      // Optionally: for small candidate sets, lazily geocode entity addresses
      // to confirm proximity (cap at MAX_GEOCODE_CANDIDATES to bound API cost).
      if (ownerLatLng && directorMatches.length <= MAX_GEOCODE_CANDIDATES) {
        for (const match of directorMatches) {
          if (!match.entity.registered_address_raw) continue;
          // Fire-and-forget geocode write; we don't use the value here but it
          // primes the cache for future runs.
          void getOrFetchEntityGeocode(
            sb,
            match.entity.neq,
            match.entity.registered_address_raw,
          );
        }
      }

      const directorOf = directorMatches.map((d) => d.entity);
      return {
        pipeline: "B",
        reqEnrichment: { isDirector: true, directorOf },
        isAggregator: false,
        reason: "individual identified as director in REQ",
      };
    }

    return {
      pipeline: "B",
      isAggregator: false,
      reason: "individual with no geocode match or director record",
    };
  }

  // Fallback (unknown owner_type)
  return {
    pipeline: "B",
    isAggregator: false,
    reason: `unrecognised owner_type: ${owner.owner_type}`,
  };
}
