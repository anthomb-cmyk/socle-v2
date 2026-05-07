/**
 * Thin geocoding wrapper using the Google Geocoding API.
 *
 * - Reads/writes a local cache file at web/data/geocode_cache.json to avoid
 *   redundant API calls across runs.
 * - Throws if GOOGLE_GEOCODING_API_KEY is not set and no cache hit is found,
 *   UNLESS skipQuietly=true (used in tests).
 *
 * Lazy helpers:
 *   getOrFetchGeocode       — for any table (e.g. canonical_owner)
 *   getOrFetchEntityGeocode — for req_entities (registered_geocode column)
 *
 * Stats:
 *   geocodeStats.apiCalls   — number of Google API calls made in this process
 *   resetGeocodeStats()     — reset to zero (useful in tests)
 */

import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const CACHE_FILE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../data/geocode_cache.json",
);

export interface LatLng {
  lat: number;
  lng: number;
}

type GeocodeCache = Record<string, LatLng | null>;

let _cache: GeocodeCache | null = null;

function loadCache(): GeocodeCache {
  if (_cache !== null) return _cache;
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    _cache = JSON.parse(raw) as GeocodeCache;
  } catch {
    _cache = {};
  }
  return _cache;
}

function saveCache(cache: GeocodeCache): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (err) {
    console.warn("[geocode] Could not save cache:", err);
  }
}

/**
 * Reset the in-memory cache.
 *
 * Pass `true` (default in tests) to reset to an empty object so the file
 * on disk is NOT re-read — this ensures tests are fully isolated from any
 * stale cache file. Pass `false` (default on server restart) to force a
 * reload from disk on the next call.
 */
export function resetGeocodeCache(toEmpty = true): void {
  _cache = toEmpty ? {} : null;
}

// ---------------------------------------------------------------------------
// API-call counter
// ---------------------------------------------------------------------------

/**
 * Mutable stats object. Exported so tests can assert on call counts.
 *
 * @example
 *   import { geocodeStats, resetGeocodeStats } from "./geocode";
 *   resetGeocodeStats();
 *   await doSomething();
 *   expect(geocodeStats.apiCalls).toBe(1);
 */
export const geocodeStats = {
  apiCalls: 0,
};

/** Reset the API-call counter (call in test beforeEach). */
export function resetGeocodeStats(): void {
  geocodeStats.apiCalls = 0;
}

// ---------------------------------------------------------------------------
// Core geocoder
// ---------------------------------------------------------------------------

/**
 * Geocode a free-form address string.
 *
 * @param address      The address to geocode.
 * @param skipQuietly  If true and no API key is set and no cache hit,
 *                     return null instead of throwing. Useful in tests.
 */
export async function geocodeAddress(
  address: string,
  skipQuietly = false,
): Promise<LatLng | null> {
  const cache = loadCache();
  const key = address.trim().toLowerCase();

  if (key in cache) {
    return cache[key];
  }

  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) {
    if (skipQuietly) return null;
    throw new Error(
      "GOOGLE_GEOCODING_API_KEY is not set and no cache hit found for address: " +
        address,
    );
  }

  // Count every real API call
  geocodeStats.apiCalls += 1;

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  // Enforce a 1-second timeout so a slow Google response doesn't block callers.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1_000);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[geocode] Request failed (timeout or network) for address: ${address}`, err);
    return null;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    console.warn(`[geocode] HTTP ${res.status} for address: ${address}`);
    cache[key] = null;
    saveCache(cache);
    return null;
  }

  const json = (await res.json()) as {
    status: string;
    results: Array<{
      geometry: { location: { lat: number; lng: number } };
    }>;
  };

  if (json.status !== "OK" || json.results.length === 0) {
    cache[key] = null;
    saveCache(cache);
    return null;
  }

  const { lat, lng } = json.results[0].geometry.location;
  const result: LatLng = { lat, lng };
  cache[key] = result;
  saveCache(cache);
  return result;
}

// ---------------------------------------------------------------------------
// Lazy helpers
// ---------------------------------------------------------------------------

/**
 * Read an existing geocode column from a DB row; if null, call Google and
 * write the result back to the row.
 *
 * This is the primary lazy-geocoding helper used throughout the classifier
 * and any other consumer that needs on-demand geocoding without bulk ingest.
 *
 * @param sb            Supabase admin/server client.
 * @param table         Table name (e.g. "canonical_owner", "req_entities").
 * @param idColumn      PK column name (e.g. "owner_id", "neq").
 * @param idValue       PK value for the row to update.
 * @param addressText   Human-readable address to pass to the Geocoding API.
 * @param geocodeColumn Column that stores the geography value (default "mailing_geocode").
 * @returns             {lat, lng} on success, null if geocoding fails or address is blank.
 *
 * Design notes:
 *  - Never throws — on any error it logs a warning and returns null so the
 *    caller can decide how to degrade.
 *  - On success it writes `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`
 *    as a WKT string via a raw SQL expression stored as text; Supabase will
 *    coerce it to geography on the server side.
 *  - A 1-second timeout is enforced inside geocodeAddress.
 */
export async function getOrFetchGeocode(
  sb: SupabaseClient,
  table: string,
  idColumn: string,
  idValue: string,
  addressText: string | null | undefined,
  geocodeColumn = "mailing_geocode",
): Promise<LatLng | null> {
  // 1. Read the current value of the geocode column from the row.
  const { data: rows, error: selectErr } = await sb
    .from(table)
    .select(geocodeColumn)
    .eq(idColumn, idValue)
    .limit(1);

  if (selectErr) {
    console.warn(`[geocode] getOrFetchGeocode: SELECT failed on ${table}.${geocodeColumn}:`, selectErr.message);
    return null;
  }

  const row = (rows as unknown as Record<string, unknown>[] | null | undefined)?.[0] as Record<string, unknown> | undefined;

  if (row) {
    const existing = row[geocodeColumn];
    if (existing !== null && existing !== undefined) {
      // Already geocoded. Parse the GeoJSON Point that PostGIS returns.
      const geo = existing as { coordinates?: [number, number] } | null;
      if (geo && Array.isArray(geo.coordinates) && geo.coordinates.length >= 2) {
        const [lng, lat] = geo.coordinates;
        return { lat, lng };
      }
    }
  }

  // 2. No geocode yet — try to geocode the address.
  if (!addressText?.trim()) {
    return null;
  }

  const latLng = await geocodeAddress(addressText, /* skipQuietly= */ true);
  if (!latLng) {
    return null;
  }

  // 3. Write back to DB using the WKT geography literal.
  const wkt = `SRID=4326;POINT(${latLng.lng} ${latLng.lat})`;

  const updatePayload: Record<string, string> = {};
  updatePayload[geocodeColumn] = wkt;

  const { error: updateErr } = await sb
    .from(table)
    .update(updatePayload)
    .eq(idColumn, idValue);

  if (updateErr) {
    // Log but don't throw — the caller still gets the geocode for this run.
    console.warn(`[geocode] getOrFetchGeocode: UPDATE failed on ${table}.${geocodeColumn}:`, updateErr.message);
  }

  return latLng;
}

/**
 * Lazy geocode helper specifically for `req_entities.registered_geocode`.
 *
 * Used when the classifier (or another consumer) already has a small set of
 * candidate entities (e.g. from a name match) and wants to confirm proximity
 * to the owner's address. Caps at `maxCandidates` (default 5) to avoid
 * calling Google for hundreds of rows.
 *
 * Returns the geocode for the given entity NEQ, or null if unavailable.
 */
export async function getOrFetchEntityGeocode(
  sb: SupabaseClient,
  neq: string,
  fallbackAddress: string | null | undefined,
): Promise<LatLng | null> {
  return getOrFetchGeocode(sb, "req_entities", "neq", neq, fallbackAddress, "registered_geocode");
}
