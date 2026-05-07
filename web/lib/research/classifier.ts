/**
 * classifier.ts — Routing classifier for canonical_owner research pipeline.
 *
 * Determines whether a given owner should be researched via:
 *   Pipeline A — direct entity linkage (company or identified individual)
 *   Pipeline B — broader search (individual without clear entity link, or aggregator address)
 *
 * Graceful degradation: if the PostGIS geocode RPC is unavailable (e.g. the
 * stored procedure hasn't been deployed yet), findEntitiesByGeocode errors are
 * caught and treated as an empty result. The classifier will still return a
 * valid RoutingDecision (Pipeline B for individuals, Pipeline A via name for
 * companies). This avoids hard failures in production while the migration is
 * being deployed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReqEntity } from "../req/types";
import {
  findEntitiesByGeocode,
  findEntitiesByName,
  findEntitiesByDirector,
} from "../req/lookup";
import { normalizePersonName } from "../req/normalize";
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

  // 3. Individual owner → geocode + director analysis
  if (owner.owner_type === "individual") {
    const normalizedPersonName = normalizePersonName(owner.canonical_name);

    // ---- Branch: has mailing_geocode ----
    if (owner.mailing_geocode) {
      // Extract lat/lng from the geocode (PostGIS geography stored as GeoJSON
      // or as a Postgres geometry string; the DB driver returns it as an opaque
      // value — we cast to a minimal interface to extract coordinates).
      const geo = owner.mailing_geocode as { coordinates?: [number, number] } | null;
      let lat: number | undefined;
      let lng: number | undefined;

      if (geo && Array.isArray(geo.coordinates)) {
        // GeoJSON Point: [lng, lat]
        [lng, lat] = geo.coordinates;
      }

      if (lat !== undefined && lng !== undefined) {
        const nearbyEntities = await safeGeocodeLookup(sb, lat, lng);

        // 3a. Exactly 1 entity AND name/director link → Pipeline A
        if (nearbyEntities.length === 1) {
          const entity = nearbyEntities[0];
          const directorMatches = await findEntitiesByDirector(sb, normalizedPersonName);
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

        // 3b. More than 10 entities → aggregator address → Pipeline B
        if (nearbyEntities.length > 10) {
          return {
            pipeline: "B",
            isAggregator: true,
            reason: `individual at aggregator address (${nearbyEntities.length} entities within 75 m)`,
          };
        }

        // 3c. 2–10 entities (or 0) → fall through to director check below
      }
    }

    // ---- Director-name lookup (no geocode OR geocode gave 2-10 results) ----
    const directorMatches = await findEntitiesByDirector(sb, normalizedPersonName);
    if (directorMatches.length > 0) {
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
