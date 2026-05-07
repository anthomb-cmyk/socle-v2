/**
 * Unit tests for the lazy geocoding helpers in geocode.ts.
 *
 * Test matrix:
 *   1.  geocodeStats.apiCalls increments on each Google API call.
 *   2.  resetGeocodeStats() resets the counter to zero.
 *   3.  geocodeAddress uses the file cache and does NOT call Google on a hit.
 *   4.  getOrFetchGeocode returns the existing geocode without calling Google.
 *   5.  getOrFetchGeocode calls geocodeAddress when geocode column is null.
 *   6.  getOrFetchGeocode writes the result back to the DB on success.
 *   7.  getOrFetchGeocode returns null (no throw) when geocoding fails.
 *   8.  getOrFetchGeocode returns null (no throw) when address is blank.
 *   9.  getOrFetchEntityGeocode delegates to getOrFetchGeocode with registered_geocode.
 *  10.  getOrFetchGeocode returns null gracefully when the SELECT fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  geocodeStats,
  resetGeocodeStats,
  resetGeocodeCache,
  geocodeAddress,
  getOrFetchGeocode,
  getOrFetchEntityGeocode,
} from "../geocode";

// ---------------------------------------------------------------------------
// Mock fetch globally so no real HTTP calls are made
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Supabase query-builder chain that resolves with `data`. */
function makeQueryChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

/** Build a mock Supabase client. */
function makeSb(selectData: unknown = null, selectError: unknown = null) {
  const queryChain = makeQueryChain(selectData, selectError);
  return {
    from: vi.fn(() => queryChain),
    _chain: queryChain,
  };
}

/** A GeoJSON Point as returned by PostGIS. */
const STORED_POINT = { coordinates: [-73.6, 45.5] }; // [lng, lat]

beforeEach(() => {
  vi.clearAllMocks();
  resetGeocodeStats();
  resetGeocodeCache();
  // By default, no Google API key → geocodeAddress returns null when skipQuietly=true
  delete process.env["GOOGLE_GEOCODING_API_KEY"];
});

// ---------------------------------------------------------------------------
// Tests: geocodeStats counter
// ---------------------------------------------------------------------------

describe("geocodeStats", () => {
  it("1. apiCalls increments on each Google API call", async () => {
    process.env["GOOGLE_GEOCODING_API_KEY"] = "test-key";

    // Mock a successful Google response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 45.5, lng: -73.6 } } }],
      }),
    });

    const result = await geocodeAddress("100 Rue Test, Montréal", /* skipQuietly= */ true);

    expect(result).toEqual({ lat: 45.5, lng: -73.6 });
    expect(geocodeStats.apiCalls).toBe(1);
  });

  it("2. resetGeocodeStats resets the counter to zero", async () => {
    geocodeStats.apiCalls = 7;
    resetGeocodeStats();
    expect(geocodeStats.apiCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: file cache hit (no API call)
// ---------------------------------------------------------------------------

describe("geocodeAddress — cache behaviour", () => {
  it("3. returns cached result without calling Google", async () => {
    process.env["GOOGLE_GEOCODING_API_KEY"] = "test-key";

    // First call — real API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 45.5, lng: -73.6 } } }],
      }),
    });

    const first = await geocodeAddress("200 Rue Cache, QC", true);
    expect(first).toEqual({ lat: 45.5, lng: -73.6 });
    expect(geocodeStats.apiCalls).toBe(1);

    // Second call — must not increment counter (cache hit)
    const second = await geocodeAddress("200 Rue Cache, QC", true);
    expect(second).toEqual({ lat: 45.5, lng: -73.6 });
    expect(geocodeStats.apiCalls).toBe(1); // still 1
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: getOrFetchGeocode
// ---------------------------------------------------------------------------

describe("getOrFetchGeocode", () => {
  it("4. returns existing geocode without calling geocodeAddress", async () => {
    const sb = makeSb([{ mailing_geocode: STORED_POINT }]) as unknown as Parameters<typeof getOrFetchGeocode>[0];

    const result = await getOrFetchGeocode(sb, "canonical_owner", "owner_id", "abc", "123 Rue X");

    expect(result).toEqual({ lat: 45.5, lng: -73.6 });
    expect(geocodeStats.apiCalls).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("5. calls geocodeAddress when geocode column is null", async () => {
    process.env["GOOGLE_GEOCODING_API_KEY"] = "test-key";

    // SELECT returns row with null geocode
    const chain = makeQueryChain([{ mailing_geocode: null }]);
    // UPDATE chain (separate call)
    const updateChain = makeQueryChain(null);
    chain.update = vi.fn(() => updateChain);

    const sb = { from: vi.fn(() => chain) } as unknown as Parameters<typeof getOrFetchGeocode>[0];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 45.5, lng: -73.6 } } }],
      }),
    });

    const result = await getOrFetchGeocode(sb, "canonical_owner", "owner_id", "abc", "123 Rue X");

    expect(result).toEqual({ lat: 45.5, lng: -73.6 });
    expect(geocodeStats.apiCalls).toBe(1);
  });

  it("6. writes the geocode back to the DB on success", async () => {
    process.env["GOOGLE_GEOCODING_API_KEY"] = "test-key";

    const chain: Record<string, unknown> = {};
    const updateEqChain: Record<string, unknown> = {};
    updateEqChain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn(() => updateEqChain);

    // SELECT chain
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [{ mailing_geocode: null }], error: null }).then(resolve);
    chain.update = vi.fn(() => updateChain);

    const sb = { from: vi.fn(() => chain) } as unknown as Parameters<typeof getOrFetchGeocode>[0];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 45.5, lng: -73.6 } } }],
      }),
    });

    await getOrFetchGeocode(sb, "canonical_owner", "owner_id", "owner-1", "100 Main St");

    // Verify update was called with WKT geography
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ mailing_geocode: expect.stringContaining("SRID=4326;POINT") }),
    );
  });

  it("7. returns null (no throw) when geocoding fails", async () => {
    // Row has null geocode; geocodeAddress returns null (no API key in env)
    const sb = makeSb([{ mailing_geocode: null }]) as unknown as Parameters<typeof getOrFetchGeocode>[0];

    const result = await getOrFetchGeocode(sb, "canonical_owner", "owner_id", "abc", "Some Address");
    expect(result).toBeNull();
  });

  it("8. returns null (no throw) when address is blank", async () => {
    const sb = makeSb([{ mailing_geocode: null }]) as unknown as Parameters<typeof getOrFetchGeocode>[0];

    const result = await getOrFetchGeocode(sb, "canonical_owner", "owner_id", "abc", "   ");
    expect(result).toBeNull();
    expect(geocodeStats.apiCalls).toBe(0);
  });

  it("10. returns null gracefully when SELECT fails", async () => {
    const sb = makeSb(null, { message: "permission denied" }) as unknown as Parameters<typeof getOrFetchGeocode>[0];

    const result = await getOrFetchGeocode(sb, "canonical_owner", "owner_id", "abc", "Any Address");
    expect(result).toBeNull();
    expect(geocodeStats.apiCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: getOrFetchEntityGeocode
// ---------------------------------------------------------------------------

describe("getOrFetchEntityGeocode", () => {
  it("9. delegates to getOrFetchGeocode with registered_geocode column", async () => {
    // Row already has a stored registered_geocode
    const sb = makeSb([{ registered_geocode: STORED_POINT }]) as unknown as Parameters<typeof getOrFetchEntityGeocode>[0];

    const result = await getOrFetchEntityGeocode(sb, "9000000001", "100 Rue Industrie");

    expect(result).toEqual({ lat: 45.5, lng: -73.6 });
    expect(geocodeStats.apiCalls).toBe(0);
    // Verify it queried req_entities
    expect(sb.from).toHaveBeenCalledWith("req_entities");
  });
});
