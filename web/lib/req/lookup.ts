/**
 * Lookup helpers for REQ entities and directors.
 *
 * All functions accept a Supabase client instance so they are usable both
 * server-side (admin client) and in tests (mocked client).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReqDirector, ReqEntity } from "./types";

/**
 * Find REQ entities whose mailing OR registered geocode is within
 * `radiusMeters` of the given lat/lng point.
 *
 * Uses PostGIS ST_DWithin on geography columns for accurate metre-based
 * distance checks.
 *
 * Results are deduped by NEQ so a company matching on both addresses
 * appears only once.
 */
export async function findEntitiesByGeocode(
  sb: SupabaseClient,
  lat: number,
  lng: number,
  radiusMeters = 75,
): Promise<ReqEntity[]> {
  // PostGIS RPC — we call a stored procedure or use raw SQL via rpc.
  // Because Supabase JS doesn't support ST_DWithin natively in the query
  // builder, we use the .rpc() escape hatch with a custom function.
  //
  // The function req_entities_near_point(lng, lat, radius) must exist in the
  // DB (created in a later migration if needed).  As a fallback we perform
  // two separate queries (mailing + registered) and merge client-side.

  const [mailingRes, registeredRes] = await Promise.all([
    sb.rpc("req_entities_near_point", {
      p_lng: lng,
      p_lat: lat,
      p_radius: radiusMeters,
      p_column: "mailing_geocode",
    }),
    sb.rpc("req_entities_near_point", {
      p_lng: lng,
      p_lat: lat,
      p_radius: radiusMeters,
      p_column: "registered_geocode",
    }),
  ]);

  const mailingRows: ReqEntity[] = mailingRes.data ?? [];
  const registeredRows: ReqEntity[] = registeredRes.data ?? [];

  // Dedupe by neq
  const seen = new Set<string>();
  const result: ReqEntity[] = [];
  for (const row of [...mailingRows, ...registeredRows]) {
    if (!seen.has(row.neq)) {
      seen.add(row.neq);
      result.push(row);
    }
  }
  return result;
}

/**
 * Find REQ entities by normalized legal name.
 *
 * Strategy (in order):
 *   1. Exact match on legal_name_normalized
 *   2. If no results, fall back to ILIKE prefix match (legal_name_normalized ILIKE '<name>%')
 *      — levenshtein / pg_trgm similarity would require an extension not guaranteed present;
 *        ILIKE prefix is reliable and fast given the existing index.
 *
 * The `fuzzyDistance` parameter is accepted for API compatibility but is not
 * used in the current ILIKE implementation (reserved for a pg_trgm upgrade).
 */
export async function findEntitiesByName(
  sb: SupabaseClient,
  normalized: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _fuzzyDistance = 3,
): Promise<ReqEntity[]> {
  // 1. Exact match
  const { data: exact } = await sb
    .from("req_entities")
    .select("*")
    .eq("legal_name_normalized", normalized);

  if (exact && exact.length > 0) return exact as ReqEntity[];

  // 2. ILIKE prefix fallback
  const { data: prefix } = await sb
    .from("req_entities")
    .select("*")
    .ilike("legal_name_normalized", `${normalized}%`);

  return (prefix ?? []) as ReqEntity[];
}

/**
 * Find REQ entities that have a director whose normalized full name matches
 * (exact match on full_name_normalized).
 */
export async function findEntitiesByDirector(
  sb: SupabaseClient,
  normalized: string,
): Promise<{ entity: ReqEntity; director: ReqDirector }[]> {
  const { data: directors } = await sb
    .from("req_directors")
    .select("*, req_entities(*)")
    .eq("full_name_normalized", normalized);

  if (!directors || directors.length === 0) return [];

  return directors.map((d) => {
    const { req_entities: entity, ...director } = d as ReqDirector & {
      req_entities: ReqEntity;
    };
    return { entity, director };
  });
}

/**
 * Get all directors for a given NEQ.
 *
 * @param currentOnly  If true (default), only returns rows where end_date IS NULL.
 */
export async function getDirectorsForEntity(
  sb: SupabaseClient,
  neq: string,
  currentOnly = true,
): Promise<ReqDirector[]> {
  let query = sb.from("req_directors").select("*").eq("neq", neq);

  if (currentOnly) {
    query = query.is("end_date", null);
  }

  const { data } = await query;
  return (data ?? []) as ReqDirector[];
}
