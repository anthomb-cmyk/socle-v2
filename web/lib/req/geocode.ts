/**
 * Thin geocoding wrapper using the Google Geocoding API.
 *
 * - Reads/writes a local cache file at web/data/geocode_cache.json to avoid
 *   redundant API calls across runs.
 * - Throws if GOOGLE_GEOCODING_API_KEY is not set and no cache hit is found,
 *   UNLESS skipQuietly=true (used in tests).
 */

import fs from "node:fs";
import path from "node:path";

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

/** Reset the in-memory cache (used in tests to isolate runs). */
export function resetGeocodeCache(): void {
  _cache = null;
}

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

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
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
