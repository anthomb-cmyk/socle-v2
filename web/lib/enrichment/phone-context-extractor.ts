// Layer D — Context-aware phone extractor (v3 enrichment redesign).
//
// Replaces the global regex sweep used by phone-utils for the enrichment path.
// Critical differences from phone-utils:
//   - Captures a ±40 char context window for every candidate match.
//   - Hard-rejects matches whose window contains NEQ / business-id markers.
//     Kills ERR-007 ("3367191080" → (336) 719-1080).
//   - Hard-rejects matches labelled "fax" / "télécopieur" within ±15 chars.
//   - Tags out-of-region area codes (non-Quebec/Ontario/Maritimes) so the gate
//     engine can reject them on non-authoritative sources.

import type { PhoneExtractionResult, PhoneExtractionRejection } from "./types";

// Same NANP rules as phone-utils
const VALID_NANP_AREA = /^[2-9][0-8]\d$/;
const VALID_NANP_EXCH = /^[2-9]\d\d$/;

/** A 10-digit phone in either spaced or compact form. */
const PHONE_TEXT_RE = /(?:\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})\b/g;
const PHONE_COMPACT_RE = /\b1?(\d{3})(\d{3})(\d{4})\b/g;

const BUSINESS_ID_MARKERS = [
  /\bNEQ\b/i,
  /num[ée]ro\s+d['e]?\s*entreprise/i,
  /quebec\s+business\s+number/i,
  /num[ée]ro\s+d['e]?\s*inscription/i,
  /\bn°\s*d['e]?\s*identification/i,
  /\bBN\b\s*[:#]/,                 // Canada Revenue Business Number marker
  /num[ée]ro\s+de?\s+certificat/i,
  /\bSIRET\b/i,
  /\bTPS\b\s*[:#]/i,
  /\bTVQ\b\s*[:#]/i,
  /num[ée]ro\s+de?\s+matricule/i,
  /\bNAS\b/,
  /\bDUNS\b/i,
];
const FAX_MARKERS = [
  /\bfax\b\s*[:#]?/i,
  /t[ée]l[ée]copieur\s*[:#]?/i,
  /t[ée]l[ée]c\.\s*[:#]?/i,
];

// Quebec/Ontario/Maritimes/National Canadian area codes considered "in region"
// for the purposes of non-authoritative source filtering. Out-of-region codes
// only pass on directory_authoritative sources.
const IN_REGION_AREA_CODES = new Set<string>([
  // Quebec
  "418","438","450","514","579","581","819","873",
  // Ontario (close-neighbour)
  "226","249","289","343","365","416","437","519","548","613","647","705","807","905",
  // Atlantic / Maritimes / Newfoundland
  "506","709","782","902",
  // Prairies / West (less common but still Canadian)
  "204","306","403","431","587","639","672","778","780","807","825","867","902","204","250","902","306",
  // Toll-free (treat as in-region — Canadian businesses commonly use)
  "800","833","844","855","866","877","888",
]);

const LOOKS_LIKE_MATRICULE = /^\s*\d{4}[\s\-]\d{2}[\s\-]\d{4}[\s\-]\d[\s\-]\d{3}[\s\-]\d{4}\s*$/;
const LOOKS_LIKE_NUMBERED_CO = /^\s*\d{4}[\s\-]\d{4}\s+(?:qu[eé]bec|que|qc|inc)\b/i;

function isValidNanp(area: string, exch: string, sub: string): boolean {
  return VALID_NANP_AREA.test(area) && VALID_NANP_EXCH.test(exch) && /^\d{4}$/.test(sub);
}

function toE164(area: string, exch: string, sub: string): string {
  return `+1${area}${exch}${sub}`;
}

function formatDisplay(e164: string): string {
  if (!/^\+1\d{10}$/.test(e164)) return e164;
  return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
}

function takeWindow(s: string, start: number, end: number, half = 40): string {
  const a = Math.max(0, start - half);
  const b = Math.min(s.length, end + half);
  return s.slice(a, b);
}

/** Quick test: does the window contain NEQ / business-id markers? */
function hasBusinessIdContext(window: string): boolean {
  return BUSINESS_ID_MARKERS.some(rx => rx.test(window));
}

/** Quick test: is the matched number labelled fax? */
function isFaxLabelled(prefix: string): boolean {
  // We only check the LEFT side of the match — fax labels appear before.
  const tail = prefix.slice(-25);
  return FAX_MARKERS.some(rx => rx.test(tail));
}

export interface ExtractOptions {
  /** When true, hard-rejects out-of-region area codes. Use this for non-authoritative sources. */
  strictAreaCode?: boolean;
}

export interface ExtractOutput {
  accepted: PhoneExtractionResult[];
  rejected: PhoneExtractionRejection[];
}

/** Extract phones from a snippet (title + description), with full context awareness. */
export function extractPhonesWithContext(text: string | null | undefined, opts: ExtractOptions = {}): ExtractOutput {
  const accepted: PhoneExtractionResult[] = [];
  const rejected: PhoneExtractionRejection[] = [];
  if (!text || !text.trim()) return { accepted, rejected };

  // Reject the whole-string suspicious shapes.
  if (LOOKS_LIKE_MATRICULE.test(text)) {
    rejected.push({ reason: "matricule", rawDigits: text.trim(), window: text });
    return { accepted, rejected };
  }
  if (LOOKS_LIKE_NUMBERED_CO.test(text)) {
    rejected.push({ reason: "numbered_company", rawDigits: text.trim(), window: text });
    return { accepted, rejected };
  }

  const seen = new Set<string>();

  // Pass 1 — formatted shapes (highest precision)
  for (const m of text.matchAll(PHONE_TEXT_RE)) {
    const rawDigits = `${m[1]}${m[2]}${m[3]}`;
    const result = evaluateMatch(text, m.index ?? 0, m[0].length, m[1], m[2], m[3], rawDigits, opts, seen);
    if (result.kind === "accept") accepted.push(result.value);
    else if (result.kind === "reject") rejected.push(result.value);
  }

  // Pass 2 — compact shapes only if pass 1 produced nothing.
  if (accepted.length === 0) {
    for (const m of text.matchAll(PHONE_COMPACT_RE)) {
      const rawDigits = `${m[1]}${m[2]}${m[3]}`;
      const result = evaluateMatch(text, m.index ?? 0, m[0].length, m[1], m[2], m[3], rawDigits, opts, seen);
      if (result.kind === "accept") accepted.push(result.value);
      else if (result.kind === "reject") rejected.push(result.value);
    }
  }

  return { accepted, rejected };
}

function evaluateMatch(
  text: string,
  start: number,
  length: number,
  area: string,
  exch: string,
  sub: string,
  rawDigits: string,
  opts: ExtractOptions,
  seen: Set<string>,
): { kind: "accept"; value: PhoneExtractionResult } | { kind: "reject"; value: PhoneExtractionRejection } | { kind: "skip" } {
  if (!isValidNanp(area, exch, sub)) {
    return { kind: "reject", value: { reason: "invalid_nanp", rawDigits, window: takeWindow(text, start, start + length) } };
  }

  const window = takeWindow(text, start, start + length, 40);
  const prefix = text.slice(Math.max(0, start - 25), start);

  // Hard reject: NEQ / business-id context near match
  if (hasBusinessIdContext(window)) {
    return { kind: "reject", value: { reason: "neq_context", rawDigits, window } };
  }

  // Hard reject: labelled fax/télécopieur near the start
  if (isFaxLabelled(prefix)) {
    return { kind: "reject", value: { reason: "fax_context", rawDigits, window } };
  }

  const e164 = toE164(area, exch, sub);
  if (seen.has(e164)) return { kind: "skip" };
  seen.add(e164);

  const isInRegion = IN_REGION_AREA_CODES.has(area);
  if (opts.strictAreaCode && !isInRegion) {
    return { kind: "reject", value: { reason: "out_of_region_non_authoritative", rawDigits, window } };
  }

  return {
    kind: "accept",
    value: {
      e164,
      display: formatDisplay(e164),
      window,
      isFax: false,
      hasBusinessIdContext: false,
      isInRegion,
    },
  };
}

// Re-export light helpers used by other modules
export { formatDisplay, isValidNanp, toE164, IN_REGION_AREA_CODES };
