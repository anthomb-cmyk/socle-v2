/**
 * reverse-address.ts — Reverse address researcher for Pipeline B.
 *
 * Brave-searches the owner's raw mailing address for associated phone numbers.
 * Returns non-authoritative EvidenceCandidates.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalOwnerRow } from "../db";
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

export type ReverseAddressCandidate = EvidenceCandidate & {
  source: "reverse_address";
};

/**
 * Research phone numbers associated with the owner's mailing address.
 *
 * Query: `"${owner.mailing_address_raw}" telephone OR phone OR téléphone`
 * Fetches the top MAX_PAGES results and extracts NANP phones.
 *
 * Returns empty array if mailing_address_raw is null or blank.
 */
export async function reverseAddressResearcher(
  sb: AnyClient,
  owner: CanonicalOwnerRow,
): Promise<ReverseAddressCandidate[]> {
  if (!owner.mailing_address_raw?.trim()) {
    return [];
  }

  const query = `"${owner.mailing_address_raw}" telephone OR phone OR téléphone`;

  let results: Awaited<ReturnType<typeof braveSearch>>;
  try {
    results = await braveSearch(query, MAX_PAGES * 2);
  } catch (err) {
    console.error("[reverse-address] braveSearch failed:", err);
    return [];
  }

  const candidates: ReverseAddressCandidate[] = [];
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
        source: "reverse_address",
        source_url: result.url,
        query_text: query,
        raw_response: null,
        structured: {
          phone,
          url: result.url,
          title: result.title,
        },
        weight_at_fetch: 0.4,
      });

      candidates.push({
        evidenceId: data?.evidence_id,
        source: "reverse_address",
        phone,
        isAuthoritative: false,
        sourceUrl: result.url,
        snippet: result.snippet || null,
        searchQuery: query,
      });
    }
  }

  return candidates;
}
