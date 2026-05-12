/**
 * req-address.ts — REQ-by-address researcher for Pipeline B.
 *
 * Looks up businesses registered at an individual owner's mailing address.
 * This replaces the old blind address web search with a government-registry
 * chain: owner address -> REQ entity address -> registered phone or one web
 * search for the matched business.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalOwnerRow } from "../db";
import { insertEvidence } from "../db";
import type { ReqEntity } from "../../req/types";
import { braveSearch } from "../../brave";
import { normalizePhone } from "../../twilio";
import { extractPhonesFromValue } from "../../role-parser/phone-utils";
import type { EvidenceCandidate } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export type ReqAddressCandidate = EvidenceCandidate & {
  source: "req_address_lookup";
};

type OwnerWithPostalFsa = CanonicalOwnerRow & {
  postal_fsa?: string | null;
};

type AddressField = "registered_address_raw" | "mailing_address_raw";

interface AddressSignature {
  civicNumbers: Set<string>;
  streetTokens: Set<string>;
}

interface AddressMatch {
  entity: ReqEntity;
  matchedAddress: string;
  matchedField: AddressField;
  civicOverlap: string[];
  streetOverlap: string[];
}

const MAX_REQ_ROWS_PER_FSA = 5_000;
const MAX_CANDIDATES = 10;
const MAX_BUSINESS_WEB_LOOKUPS = 5;
const MAX_BUSINESS_SEARCH_RESULTS = 3;
const FETCH_TIMEOUT_MS = 8_000;
const REQ_PUBLIC_SOURCE_URL = "https://www.registreentreprises.gouv.qc.ca/";

const STREET_TYPES = new Set([
  "allee",
  "avenue",
  "ave",
  "av",
  "boulevard",
  "boul",
  "chemin",
  "ch",
  "cote",
  "croissant",
  "cr",
  "impasse",
  "montee",
  "place",
  "rang",
  "route",
  "rte",
  "rue",
  "terrasse",
]);

const ADDRESS_STOPWORDS = new Set([
  ...STREET_TYPES,
  "app",
  "apt",
  "bureau",
  "bur",
  "canada",
  "chef",
  "cp",
  "du",
  "de",
  "des",
  "est",
  "local",
  "nord",
  "ouest",
  "qc",
  "quebec",
  "saint",
  "sainte",
  "ste",
  "st",
  "sud",
  "succ",
  "suite",
  "unite",
]);

async function safeFetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SocleBot/1.0)" },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeAddress(value: string): string[] {
  return normalizeText(value).split(" ").filter(Boolean);
}

function extractFsaFromText(value: string | null | undefined): string {
  const match = value
    ?.toUpperCase()
    .match(/\b([ABCEGHJ-NPRSTVXY]\d[A-Z])(?:\s?\d[A-Z]\d)?\b/);
  return match?.[1] ?? "";
}

function ownerPostalFsa(owner: OwnerWithPostalFsa): string {
  const raw =
    owner.mailing_postal_fsa?.trim() ||
    owner.postal_fsa?.trim() ||
    "";
  return (
    extractFsaFromText(raw) ||
    extractFsaFromText(owner.mailing_address_raw) ||
    raw.toUpperCase()
  );
}

function hasPoBoxShape(tokens: string[]): boolean {
  const joined = tokens.join(" ");
  return (
    joined.includes("po box") ||
    joined.includes("p o box") ||
    joined.includes("case postale") ||
    joined.includes("boite postale")
  );
}

function findStreetTypeIndex(tokens: string[]): number {
  return tokens.findIndex((token) => STREET_TYPES.has(token));
}

function extractCivicNumbers(tokens: string[], streetTypeIndex: number): Set<string> {
  const numbersBeforeStreet =
    streetTypeIndex > 0
      ? tokens.slice(0, streetTypeIndex).filter((token) => /^\d{1,6}$/.test(token))
      : [];

  if (numbersBeforeStreet.length === 1) {
    return new Set(numbersBeforeStreet);
  }

  if (numbersBeforeStreet.length > 1) {
    const first = Number(numbersBeforeStreet[0]);
    const last = Number(numbersBeforeStreet[numbersBeforeStreet.length - 1]);

    // Quebec addresses often use "unit-civic street" (500-1395 rue X). In
    // that shape the civic is the last number. Small ranges keep both ends.
    if (Number.isFinite(first) && Number.isFinite(last) && Math.abs(last - first) <= 20) {
      return new Set(numbersBeforeStreet);
    }
    return new Set([numbersBeforeStreet[numbersBeforeStreet.length - 1]]);
  }

  const firstNumber = tokens.find((token) => /^\d{1,6}$/.test(token));
  return firstNumber ? new Set([firstNumber]) : new Set();
}

function extractStreetTokens(tokens: string[], streetTypeIndex: number): Set<string> {
  const start =
    streetTypeIndex >= 0
      ? streetTypeIndex + 1
      : Math.max(0, tokens.findIndex((token) => /^\d{1,6}$/.test(token)) + 1);

  const significant = tokens
    .slice(start)
    .filter((token) => /^[a-z]+$/.test(token))
    .filter((token) => token.length >= 3)
    .filter((token) => !ADDRESS_STOPWORDS.has(token))
    .slice(0, 4);

  return new Set(significant);
}

function addressSignature(address: string | null | undefined): AddressSignature | null {
  if (!address?.trim()) return null;

  const tokens = tokenizeAddress(address);
  if (tokens.length === 0 || hasPoBoxShape(tokens)) return null;

  const streetTypeIndex = findStreetTypeIndex(tokens);
  const civicNumbers = extractCivicNumbers(tokens, streetTypeIndex);
  const streetTokens = extractStreetTokens(tokens, streetTypeIndex);

  if (civicNumbers.size === 0 || streetTokens.size === 0) return null;
  return { civicNumbers, streetTokens };
}

function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => right.has(value));
}

function matchAddress(
  ownerSignature: AddressSignature,
  entity: ReqEntity,
): AddressMatch | null {
  for (const field of ["registered_address_raw", "mailing_address_raw"] as const) {
    const matchedAddress = entity[field];
    const entitySignature = addressSignature(matchedAddress);
    if (!matchedAddress || !entitySignature) continue;

    const civicOverlap = intersection(ownerSignature.civicNumbers, entitySignature.civicNumbers);
    if (civicOverlap.length === 0) continue;

    const streetOverlap = intersection(ownerSignature.streetTokens, entitySignature.streetTokens);
    const minimumStreetOverlap =
      ownerSignature.streetTokens.size >= 2 && entitySignature.streetTokens.size >= 2 ? 2 : 1;
    if (streetOverlap.length < minimumStreetOverlap) continue;

    return {
      entity,
      matchedAddress,
      matchedField: field,
      civicOverlap,
      streetOverlap,
    };
  }

  return null;
}

function reqAddressSearchQuery(ownerAddress: string, fsa: string): string {
  return `REQ address lookup postal_fsa=${fsa} owner_address="${ownerAddress}"`;
}

function reqSnippet(match: AddressMatch, phoneSource: string, directorNames: string[] = []): string {
  return [
    `REQ address match: ${match.entity.legal_name} (${match.entity.neq})`,
    `${match.matchedField}="${match.matchedAddress}"`,
    `matched civic=${match.civicOverlap.join(",")} street=${match.streetOverlap.join(",")}`,
    directorNames.length > 0 ? `REQ directors=${directorNames.join(", ")}` : null,
    phoneSource,
  ].filter(Boolean).join("; ");
}

async function getReqDirectorNames(sb: AnyClient, neq: string): Promise<string[]> {
  try {
    const { data, error } = await sb
      .from("req_directors")
      .select("full_name")
      .eq("neq", neq);

    if (error) return [];

    return [...new Set(
      ((data ?? []) as Array<{ full_name?: string | null }>)
        .map((row) => row.full_name?.trim() ?? "")
        .filter(Boolean),
    )];
  } catch {
    return [];
  }
}

async function insertReqAddressEvidence(
  sb: AnyClient,
  owner: CanonicalOwnerRow,
  match: AddressMatch,
  phone: string,
  sourceUrl: string,
  searchQuery: string,
  snippet: string,
  weight: number,
  directorNames: string[] = [],
): Promise<string | undefined> {
  const { data, error } = await insertEvidence(sb, {
    owner_id: owner.owner_id,
    source: "req_address_lookup",
    source_url: sourceUrl,
    query_text: searchQuery,
    raw_response: null,
    structured: {
      phone,
      neq: match.entity.neq,
      legal_name: match.entity.legal_name,
      matched_field: match.matchedField,
      matched_address: match.matchedAddress,
      civic_overlap: match.civicOverlap,
      street_overlap: match.streetOverlap,
      req_directors: directorNames,
    },
    weight_at_fetch: weight,
  });

  if (error) {
    console.error("[req-address] evidence insert failed:", error);
  }

  return data?.evidence_id;
}

async function findPhoneFromBusinessSearch(
  match: AddressMatch,
  fsa: string,
): Promise<{
  phone: string;
  sourceUrl: string;
  snippet: string;
  searchQuery: string;
} | null> {
  const searchQuery = `"${match.entity.legal_name}" "${fsa}" telephone OR phone`;

  let results: Awaited<ReturnType<typeof braveSearch>>;
  try {
    results = await braveSearch(searchQuery, MAX_BUSINESS_SEARCH_RESULTS);
  } catch (err) {
    console.error(
      "[req-address] braveSearch failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  for (const result of results.slice(0, MAX_BUSINESS_SEARCH_RESULTS)) {
    const html = await safeFetchText(result.url);
    const phones = [
      ...new Set([
        ...extractPhonesFromValue(result.snippet),
        ...extractPhonesFromValue(html),
      ]),
    ];
    const phone = phones[0];
    if (!phone) continue;

    return {
      phone,
      sourceUrl: result.url,
      snippet: reqSnippet(
        match,
        `Brave result: ${result.title}${result.snippet ? ` — ${result.snippet}` : ""}`,
      ),
      searchQuery,
    };
  }

  return null;
}

/**
 * Find phone candidates by matching the owner's mailing address to REQ
 * registered/mailing addresses inside the same FSA.
 */
export async function reqAddressResearcher(
  sb: AnyClient,
  owner: CanonicalOwnerRow,
): Promise<ReqAddressCandidate[]> {
  const ownerAddress = owner.mailing_address_raw?.trim();
  if (!ownerAddress) return [];

  const ownerSignature = addressSignature(ownerAddress);
  if (!ownerSignature) return [];

  const fsa = ownerPostalFsa(owner as OwnerWithPostalFsa);
  if (!fsa) return [];

  const { data: reqRows, error } = await sb
    .from("req_entities")
    .select("*")
    .eq("postal_fsa", fsa)
    .limit(MAX_REQ_ROWS_PER_FSA);

  if (error) {
    console.error("[req-address] req_entities lookup failed:", error.message);
    return [];
  }

  const matches = ((reqRows ?? []) as ReqEntity[])
    .map((entity) => matchAddress(ownerSignature, entity))
    .filter((match): match is AddressMatch => match !== null)
    .sort((a, b) => {
      const aHasPhone = a.entity.registered_phone?.trim() ? 1 : 0;
      const bHasPhone = b.entity.registered_phone?.trim() ? 1 : 0;
      return bHasPhone - aHasPhone;
    });

  if ((reqRows?.length ?? 0) >= MAX_REQ_ROWS_PER_FSA) {
    console.warn(
      `[req-address] FSA ${fsa} hit ${MAX_REQ_ROWS_PER_FSA} row cap before local address matching`,
    );
  }

  const candidates: ReqAddressCandidate[] = [];
  const seenPhones = new Set<string>();
  const baseReqQuery = reqAddressSearchQuery(ownerAddress, fsa);
  let businessWebLookups = 0;

  for (const match of matches) {
    if (candidates.length >= MAX_CANDIDATES) break;

    const registeredPhone = match.entity.registered_phone
      ? normalizePhone(match.entity.registered_phone)
      : "";

    if (registeredPhone) {
      if (seenPhones.has(registeredPhone)) continue;
      seenPhones.add(registeredPhone);

      const directorNames = await getReqDirectorNames(sb, match.entity.neq);
      const snippet = reqSnippet(match, "registered_phone present in req_entities", directorNames);
      const evidenceId = await insertReqAddressEvidence(
        sb,
        owner,
        match,
        registeredPhone,
        REQ_PUBLIC_SOURCE_URL,
        baseReqQuery,
        snippet,
        1.0,
        directorNames,
      );

      candidates.push({
        evidenceId,
        source: "req_address_lookup",
        phone: registeredPhone,
        isAuthoritative: true,
        sourceUrl: REQ_PUBLIC_SOURCE_URL,
        snippet,
        searchQuery: baseReqQuery,
      });
      continue;
    }

    if (businessWebLookups >= MAX_BUSINESS_WEB_LOOKUPS) break;
    businessWebLookups += 1;

    const webPhone = await findPhoneFromBusinessSearch(match, fsa);
    if (!webPhone || seenPhones.has(webPhone.phone)) continue;
    seenPhones.add(webPhone.phone);

    const directorNames = await getReqDirectorNames(sb, match.entity.neq);
    const snippet = reqSnippet(
      match,
      webPhone.snippet.replace(/^REQ address match:[^;]+;\s*[^;]+;\s*matched [^;]+;\s*/i, ""),
      directorNames,
    );

    const evidenceId = await insertReqAddressEvidence(
      sb,
      owner,
      match,
      webPhone.phone,
      webPhone.sourceUrl,
      webPhone.searchQuery,
      snippet,
      0.85,
      directorNames,
    );

    candidates.push({
      evidenceId,
      source: "req_address_lookup",
      phone: webPhone.phone,
      isAuthoritative: false,
      sourceUrl: webPhone.sourceUrl,
      snippet,
      searchQuery: webPhone.searchQuery,
    });
  }

  return candidates.slice(0, MAX_CANDIDATES);
}
