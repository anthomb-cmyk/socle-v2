// Brave Search — two separate search functions for the address-first pipeline.
//
// runAddressSearch(ctx)  — Stage 1
//   Always runs first. Uses mailing address (preferred) or property address.
//   Goal: find who is operating at that address and get their phone.
//   High signal if phone is tied directly to the address.
//
// runCompanySearch(ctx)  — Stage 2
//   Only runs if address search found nothing useful.
//   Uses company legal name, simplified variants, and director/officer name.
//
// Required env: BRAVE_API_KEY
// All candidates include the exact query used and what field was matched.

import type { LeadContext, StageResult, PhoneCandidate, MatchedOn } from "./types";
import { extractPhonesFromValue } from "@/lib/role-parser/phone-utils";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  title:       string;
  url:         string;
  description: string;
}
interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

// ── Low-level Brave call ─────────────────────────────────────────────────────

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

// ── Confidence scoring helpers ───────────────────────────────────────────────

/** Score a candidate based on how well the source snippet + URL match the lead. */
function scoreAddressCandidate(
  snippet: string,
  url: string,
  ctx: LeadContext,
): { confidence: number; matchedOn: MatchedOn } {
  const text = (snippet + " " + url).toLowerCase();
  const addr  = (ctx.mailingAddress ?? ctx.propertyAddress ?? "").toLowerCase();
  const city  = (ctx.mailingCity ?? ctx.propertyCity ?? "").toLowerCase();
  const postal = (ctx.mailingPostal ?? "").toLowerCase().replace(/\s/g, "");

  // Strong signals — exact address fragment appears
  const hasAddr   = addr.length > 4 && text.includes(addr.slice(0, Math.min(addr.length, 15)));
  const hasCity   = city.length > 2 && text.includes(city);
  const hasPostal = postal.length >= 5 && text.includes(postal.slice(0, 3).toLowerCase());

  // Company/director name in snippet boosts confidence
  const companyWords = (ctx.companyName ?? "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const nameWords    = (ctx.fullName ?? "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const hasCompanyHit = companyWords.some(w => text.includes(w));
  const hasNameHit    = nameWords.some(w => text.includes(w));

  let confidence = 40; // base
  if (hasAddr)   confidence += 25;
  if (hasCity)   confidence += 10;
  if (hasPostal) confidence += 10;
  if (hasCompanyHit || hasNameHit) confidence += 15;

  // Cap
  confidence = Math.min(confidence, 95);

  // Determine matchedOn
  let matchedOn: MatchedOn = "property_address";
  if (ctx.mailingAddress && hasAddr) {
    matchedOn = hasCompanyHit || hasNameHit ? "address_company" : "mailing_address";
  } else if (hasPostal) {
    matchedOn = "mailing_postal";
  }

  return { confidence, matchedOn };
}

// ── Shared extraction helper ─────────────────────────────────────────────────

function extractCandidatesFromResults(
  results: BraveWebResult[],
  query: string,
  getMatchedOn: (snippet: string, url: string) => { confidence: number; matchedOn: MatchedOn },
  stage: "address_search" | "company_search",
  seen: Set<string>,
): PhoneCandidate[] {
  const found: PhoneCandidate[] = [];
  for (const r of results) {
    const combined = `${r.title} ${r.description}`;
    const phones = extractPhonesFromValue(combined);
    for (const e164 of phones) {
      if (seen.has(e164)) continue;
      seen.add(e164);
      const { confidence, matchedOn } = getMatchedOn(combined, r.url);
      found.push({
        phoneRaw:          e164,
        phoneE164:         e164,
        stage,
        matchedOn,
        sourceLabel:       "brave_search",
        sourceUrl:         r.url,
        snippet:           `${r.title}: ${r.description}`.slice(0, 500),
        searchQuery:       query,
        candidateName:     r.title.slice(0, 200),
        candidateAddress:  null,
        relatedEntityName: null,
        relatedEntityType: null,
        initialConfidence: confidence,
      });
    }
  }
  return found;
}

// ── Stage 1: Address search ──────────────────────────────────────────────────
//
// Always starts with the mailing/postal address.
// Uses 4-6 query variants focusing on address → city → postal.
// Stop querying as soon as a high-confidence candidate is found.
//
// Query strategy (mailing address preferred, property address fallback):
//   "<addr> <city> <postal> téléphone"
//   "<addr> <city> entreprise téléphone"
//   "<addr> <city> Québec téléphone"
//   "<addr> <postal>"
//   "<addr> <city> Canada"

export async function runAddressSearch(ctx: LeadContext): Promise<StageResult> {
  const addr   = ctx.mailingAddress ?? ctx.propertyAddress;
  const city   = ctx.mailingCity ?? ctx.propertyCity;
  const postal = ctx.mailingPostal;

  if (!addr) return { found: false, reason: "no address available for search" };

  const cityStr   = city   ? ` ${city}`   : "";
  const postalStr = postal ? ` ${postal}` : "";
  const provinceSuffix = "Québec";

  const queries: string[] = [
    `${addr}${cityStr}${postalStr} téléphone`,
    `${addr}${cityStr} entreprise téléphone`,
    `${addr}${cityStr} ${provinceSuffix} téléphone`,
  ];
  if (postalStr) queries.push(`${addr}${postalStr}`);
  if (cityStr)   queries.push(`${addr}${cityStr} Canada`);

  const seen = new Set<string>();
  const candidates: PhoneCandidate[] = [];

  const score = (snippet: string, url: string) => scoreAddressCandidate(snippet, url, ctx);

  for (const query of queries) {
    let results: BraveWebResult[];
    try { results = await braveSearch(query); }
    catch { continue; }

    const found = extractCandidatesFromResults(results, query, score, "address_search", seen);
    candidates.push(...found);

    // Stop querying early if we already have a high-confidence hit
    const HIGH = 80;
    if (candidates.some(c => c.initialConfidence >= HIGH)) break;
    if (candidates.length >= 3) break;
  }

  if (candidates.length === 0) return { found: false };
  // Return sorted: highest confidence first
  candidates.sort((a, b) => b.initialConfidence - a.initialConfidence);
  return { found: true, candidates };
}

// ── Stage 2: Company/person search ──────────────────────────────────────────
//
// Only runs if address search found nothing useful.
// Searches by:
//   - Legal company name (full + simplified variants)
//   - Director/officer full name + city
//   - Director name + mailing address
//
// Query strategy:
//   "<company> téléphone"
//   "<simplified company> <city> téléphone"
//   "<company> <city> téléphone"
//   "<company> <postal> téléphone"
//   "<director> <city> téléphone"
//   "<director> <address> téléphone"

export async function runCompanySearch(ctx: LeadContext): Promise<StageResult> {
  const city   = ctx.mailingCity ?? ctx.propertyCity ?? "";
  const postal = ctx.mailingPostal ?? "";
  const addr   = ctx.mailingAddress ?? ctx.propertyAddress ?? "";

  // Simplify company name: remove legal suffixes
  function simplify(name: string): string {
    return name
      .replace(/\b(INC\.?|LTÉE\.?|LTD\.?|S\.E\.N\.C\.|S\.E\.C\.|INC|LTEE|LTD)\b/gi, "")
      .replace(/\s+\d{4}\s*/g, " ")   // remove year stamps like "2015"
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  const queries: string[] = [];

  if (ctx.companyName) {
    const simple = simplify(ctx.companyName);
    queries.push(`"${ctx.companyName}" téléphone`);
    if (city) queries.push(`"${ctx.companyName}" ${city} téléphone`);
    if (simple !== ctx.companyName && simple.length > 4) {
      queries.push(`"${simple}" ${city} téléphone`);
      if (postal) queries.push(`"${simple}" ${postal} téléphone`);
    }
  }

  if (ctx.fullName) {
    if (city) queries.push(`"${ctx.fullName}" ${city} téléphone`);
    if (addr) queries.push(`"${ctx.fullName}" "${addr}" téléphone`);
  }

  if (ctx.secondaryName && city) {
    queries.push(`"${ctx.secondaryName}" ${city} téléphone`);
  }

  if (queries.length === 0) return { found: false, reason: "no company/person name available" };

  const seen = new Set<string>();
  const candidates: PhoneCandidate[] = [];

  // Confidence scorer for company search results
  const score = (snippet: string, url: string): { confidence: number; matchedOn: MatchedOn } => {
    const text = (snippet + " " + url).toLowerCase();
    const city_l = city.toLowerCase();
    const addr_l = addr.toLowerCase();

    const compWords = (ctx.companyName ?? "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const nameWords = (ctx.fullName ?? "").toLowerCase().split(/\s+/).filter(w => w.length > 3);

    const hasCompany = compWords.some(w => text.includes(w));
    const hasName    = nameWords.some(w => text.includes(w));
    const hasCity    = city_l.length > 2 && text.includes(city_l);
    const hasAddr    = addr_l.length > 4 && text.includes(addr_l.slice(0, 12));

    let confidence = 40;
    if (hasCompany) confidence += 20;
    if (hasName)    confidence += 15;
    if (hasCity)    confidence += 10;
    if (hasAddr)    confidence += 15;
    confidence = Math.min(confidence, 90);

    const matchedOn: MatchedOn = hasName && !hasCompany ? "director_name" : "company_name";
    return { confidence, matchedOn };
  };

  for (const query of queries.slice(0, 6)) {
    let results: BraveWebResult[];
    try { results = await braveSearch(query); }
    catch { continue; }

    const found = extractCandidatesFromResults(results, query, score, "company_search", seen);
    candidates.push(...found);

    const HIGH = 80;
    if (candidates.some(c => c.initialConfidence >= HIGH)) break;
    if (candidates.length >= 3) break;
  }

  if (candidates.length === 0) return { found: false };
  candidates.sort((a, b) => b.initialConfidence - a.initialConfidence);
  return { found: true, candidates };
}
