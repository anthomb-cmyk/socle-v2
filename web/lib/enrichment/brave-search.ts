// Stage 1 — Brave Search
//
// Searches using combinations of:
//   - company name + "téléphone"
//   - contact name + city + "téléphone"
//   - mailing address + phone
//   - property address + phone
//
// Required env: BRAVE_API_KEY
// Returns raw candidates with confidence = 60 (source is public web — not authoritative).

import type { LeadContext, StageResult, PhoneCandidate } from "./types";
import { extractPhonesFromValue } from "@/lib/role-parser/phone-utils";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const BASE_CONFIDENCE = 60;

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}
interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

async function braveSearch(query: string): Promise<BraveWebResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error("BRAVE_API_KEY not configured");

  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=5&country=CA&search_lang=fr`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!res.ok) throw new Error(`Brave API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as BraveResponse;
  return data.web?.results ?? [];
}

function buildQueries(ctx: LeadContext): string[] {
  const queries: string[] = [];
  const city = ctx.propertyCity ?? ctx.mailingCity ?? "";

  // Company-focused queries
  if (ctx.companyName) {
    queries.push(`"${ctx.companyName}" téléphone`);
    queries.push(`"${ctx.companyName}" ${city} téléphone`);
    if (ctx.mailingAddress) queries.push(`"${ctx.companyName}" "${ctx.mailingAddress}" téléphone`);
  }

  // Person-focused queries
  if (ctx.fullName) {
    queries.push(`"${ctx.fullName}" ${city} téléphone`);
    queries.push(`"${ctx.fullName}" immeuble téléphone`);
  }
  if (ctx.secondaryName) {
    queries.push(`"${ctx.secondaryName}" ${city} téléphone`);
  }

  // Address-based queries
  if (ctx.propertyAddress && city) {
    queries.push(`"${ctx.propertyAddress}" ${city} téléphone`);
  }
  if (ctx.mailingAddress && ctx.mailingCity) {
    queries.push(`"${ctx.mailingAddress}" "${ctx.mailingCity}" téléphone`);
  }

  return queries.slice(0, 6); // cap at 6 API calls per lead
}

export async function runBraveSearch(ctx: LeadContext): Promise<StageResult> {
  const queries = buildQueries(ctx);
  if (queries.length === 0) return { found: false, reason: "no search terms available" };

  const seenPhones = new Set<string>();
  const candidates: PhoneCandidate[] = [];

  for (const query of queries) {
    let results: BraveWebResult[];
    try {
      results = await braveSearch(query);
    } catch {
      continue; // skip this query on error, try next
    }

    for (const r of results) {
      const combined = `${r.title} ${r.description}`;
      const phones = extractPhonesFromValue(combined);
      for (const e164 of phones) {
        if (seenPhones.has(e164)) continue;
        seenPhones.add(e164);
        candidates.push({
          phoneRaw: e164,
          phoneE164: e164,
          stage: "brave",
          sourceLabel: "brave_search",
          sourceUrl: r.url,
          snippet: `[${query}] ${r.title}: ${r.description}`.slice(0, 500),
          initialConfidence: BASE_CONFIDENCE,
        });
      }
    }

    if (candidates.length >= 3) break; // found enough, stop querying
  }

  if (candidates.length === 0) return { found: false };
  return { found: true, candidates };
}
