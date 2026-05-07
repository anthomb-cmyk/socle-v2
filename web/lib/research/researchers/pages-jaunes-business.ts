/**
 * pages-jaunes-business.ts — Pages Jaunes (Yellow Pages Canada) researcher.
 *
 * Uses Brave Search restricted to pagesjaunes.ca to find a company listing,
 * then extracts phone numbers from the snippet and page HTML.
 * Results are non-authoritative directory matches.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalOwnerRow } from "../db";
import type { ReqEntity } from "../../req/types";
import { insertEvidence } from "../db";
import { braveSearch } from "../../brave";
import { extractPhonesFromValue } from "../../role-parser/phone-utils";
import type { EvidenceCandidate } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

const MAX_PAGES = 3;
const FETCH_TIMEOUT_MS = 8_000;

async function safeFetchText(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SocleBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Research a company's Pages Jaunes listing for phone numbers.
 *
 * Query: `site:pagesjaunes.ca "${entity.legal_name}"`
 * Fetches the top MAX_PAGES results and extracts NANP phones.
 */
export async function pagesJaunesBusinessResearcher(
  sb: AnyClient,
  owner: CanonicalOwnerRow,
  target: ReqEntity,
): Promise<EvidenceCandidate[]> {
  const query = `site:pagesjaunes.ca "${target.legal_name}"`;

  let results: Awaited<ReturnType<typeof braveSearch>>;
  try {
    results = await braveSearch(query, MAX_PAGES * 2);
  } catch (err) {
    console.error("[pages-jaunes-business] braveSearch failed:", err);
    return [];
  }

  const candidates: EvidenceCandidate[] = [];
  const seenPhones = new Set<string>();

  for (const result of results.slice(0, MAX_PAGES)) {
    const html = await safeFetchText(result.url);
    const phonesInPage = extractPhonesFromValue(html);
    const phonesInSnippet = extractPhonesFromValue(result.snippet);
    const allPhones = [...new Set([...phonesInPage, ...phonesInSnippet])];

    for (const phone of allPhones) {
      if (seenPhones.has(phone)) continue;
      seenPhones.add(phone);

      const { data } = await insertEvidence(sb, {
        owner_id: owner.owner_id,
        source: "pages_jaunes_business",
        source_url: result.url,
        query_text: query,
        raw_response: null,
        structured: {
          phone,
          url: result.url,
          title: result.title,
        },
        weight_at_fetch: 0.5,
      });

      candidates.push({
        evidenceId: data?.evidence_id,
        source: "pages_jaunes_business",
        phone,
        isAuthoritative: false,
        sourceUrl: result.url,
      });
    }
  }

  return candidates;
}
