/**
 * brave.ts — Lightweight Brave Search API client for Pipeline researchers.
 *
 * Required env: BRAVE_API_KEY
 * Throws if key is missing unless NODE_ENV === "test".
 */

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export interface BraveResult {
  url: string;
  title: string;
  snippet: string;
}

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveApiResponse {
  web?: { results?: BraveWebResult[] };
}

/**
 * Search the web via Brave Search API.
 *
 * @param query   The search query string.
 * @param count   Number of results to request (default 10, max 20).
 * @returns       Array of { url, title, snippet }.
 * @throws        Error if BRAVE_API_KEY is missing (skipped in test mode).
 */
export async function braveSearch(
  query: string,
  count = 10,
): Promise<BraveResult[]> {
  const apiKey = process.env.BRAVE_API_KEY?.trim() ?? "";

  if (!apiKey) {
    if (process.env.NODE_ENV === "test") {
      // In tests the caller is expected to mock global.fetch — return empty.
      return [];
    }
    throw new Error("BRAVE_API_KEY not set");
  }

  // Daily cap (cost control during cutover).
  try {
    const { createSupabaseAdminClient } = await import("./supabase-server");
    const { checkAndIncrementDailyCap, getBraveDailyCap } = await import(
      "./research/rate-limits"
    );
    const sb = createSupabaseAdminClient();
    const cap = await checkAndIncrementDailyCap(sb, "brave_queries", getBraveDailyCap());
    if (!cap.allowed) {
      console.warn(`[brave] daily cap reached (${cap.used}); skipping query`);
      return [];
    }
  } catch (err) {
    console.warn("[brave] cap check skipped:", err);
  }

  const url =
    `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}` +
    `&count=${count}&country=CA&search_lang=fr`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Brave API ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as BraveApiResponse;
  return (data.web?.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.description ?? "",
  }));
}
