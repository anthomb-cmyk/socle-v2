/**
 * name-postal-directory.ts — Name + postal directory researcher for Pipeline B.
 *
 * Searches canada411, pagesjaunes, and 411.ca for an individual owner's phone
 * by combining their canonical name with their postal FSA.
 *
 * Returns non-authoritative EvidenceCandidates, with an extra
 * `postalCorroborated` flag when the result's URL or snippet contains the FSA.
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

/** Directories we treat as authoritative-ish (directory_match flag). */
const DIRECTORY_HOSTS = ["pagesjaunes.ca", "canada411.ca", "411.ca"];

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

function isDirectoryUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DIRECTORY_HOSTS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function containsFsa(text: string, fsa: string): boolean {
  if (!fsa) return false;
  // FSA is the first 3 chars of a Canadian postal code (e.g. "H3B")
  // Look for the FSA optionally followed by postal code digits
  const escaped = fsa.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i").test(text);
}

export interface NamePostalDirectoryCandidate extends EvidenceCandidate {
  source: "name_postal_directory";
  /** True when the search result URL or snippet contains the owner's postal FSA */
  postalCorroborated: boolean;
  /** True when the result came from a known directory (canada411, pagesjaunes, 411.ca) */
  directoryMatch: boolean;
}

/**
 * Research an individual owner's phone via Canadian white-page directories.
 *
 * Query: `"${owner.canonical_name}" "${owner.mailing_postal_fsa}" canada411 OR pagesjaunes`
 *
 * Requires canonical_name and at least one of mailing_postal_fsa to be present;
 * returns empty array otherwise (soft fail).
 */
export async function namePostalDirectoryResearcher(
  sb: AnyClient,
  owner: CanonicalOwnerRow,
): Promise<NamePostalDirectoryCandidate[]> {
  if (!owner.canonical_name?.trim()) {
    return [];
  }

  const fsa = owner.mailing_postal_fsa?.trim() ?? "";
  const fsaPart = fsa ? ` "${fsa}"` : "";
  const query = `"${owner.canonical_name}"${fsaPart} canada411 OR pagesjaunes`;

  let results: Awaited<ReturnType<typeof braveSearch>>;
  try {
    results = await braveSearch(query, MAX_PAGES * 2);
  } catch (err) {
    console.error("[name-postal-directory] braveSearch failed:", err);
    return [];
  }

  const candidates: NamePostalDirectoryCandidate[] = [];
  const seenPhones = new Set<string>();

  for (const result of results.slice(0, MAX_PAGES)) {
    const directoryMatch = isDirectoryUrl(result.url);
    const html = await safeFetchText(result.url);
    const phonesInPage = extractPhonesFromValue(html);
    const phonesInSnippet = extractPhonesFromValue(result.snippet);
    const allPhones = [...new Set([...phonesInPage, ...phonesInSnippet])];

    // Postal corroboration: FSA appears in snippet, URL, or fetched HTML
    const postalCorroborated =
      fsa.length > 0 &&
      (containsFsa(result.snippet, fsa) ||
        containsFsa(result.url, fsa) ||
        containsFsa(html, fsa));

    for (const phone of allPhones) {
      if (seenPhones.has(phone)) continue;
      seenPhones.add(phone);

      const { data } = await insertEvidence(sb, {
        owner_id: owner.owner_id,
        source: "name_postal_directory",
        source_url: result.url,
        query_text: query,
        raw_response: null,
        structured: {
          phone,
          url: result.url,
          title: result.title,
          directory_match: directoryMatch,
          postal_corroborated: postalCorroborated,
          fsa,
        },
        weight_at_fetch: directoryMatch ? 0.6 : 0.4,
      });

      candidates.push({
        evidenceId: data?.evidence_id,
        source: "name_postal_directory",
        phone,
        isAuthoritative: false,
        sourceUrl: result.url,
        snippet: result.snippet || null,
        searchQuery: query,
        postalCorroborated,
        directoryMatch,
      });
    }
  }

  return candidates;
}
