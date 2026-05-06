// Quebec-aware address parser used by the v3 enrichment pre-flight gate.
//
// The parser is intentionally conservative: it only extracts fields it is
// confident about. Anything ambiguous comes back as null so the pre-flight
// gate can mark the lead as unsuitable.
//
// Inputs we see in practice:
//   "3720 AVENUE KENT, MONTREAL QC H3S 1N3"
//   "3720 Avenue Kent, Montréal QC H3S 1N3"
//   "3720 Av. Kent, Montréal, QC H3S1N3"
//   "8814 RUE NOTRE-DAME EST, MONTREAL QC H1L 3M3"
//   "408 - 1020 RUE LEVERT, VERDUN QC H3E 0G4"           ← unit-prefix form
//   "1094 RUE BERUBE, SHERBROOKE J1N 1B6"                 ← missing province
//   "189-197 Rue Desjardins Nord, Granby QC J2G 0A1"      ← civic range
//   "BROMONT QC J2L 2X5"                                  ← incomplete (no street)
//   "MONTREAL QC H2V 2M1"                                 ← incomplete
//
// We must classify the last two as INCOMPLETE so they never reach search.

import type { ParsedAddress } from "./types";

const POSTAL_RE = /\b([A-CEGHJ-NPR-TVXY]\d[A-CEGHJ-NPR-TV-Z])\s?(\d[A-CEGHJ-NPR-TV-Z]\d)\b/i;
const PROVINCE_RE = /\b(QC|ON|NB|NS|PE|NL|MB|SK|AB|BC|YT|NT|NU|QU[ÉE]BEC|ONTARIO|NEW\s*BRUNSWICK|NOVA\s*SCOTIA|MANITOBA|ALBERTA)\b/i;

/** Strict civic prefix at the start of an address line:
 *   "3720 ..."  → civicNumber=3720
 *   "189-197 ..." → civicRange="189-197"
 *   "408 - 1020 ..." → unit=408, civicNumber=1020 (Quebec unit-prefix form)
 */
const CIVIC_RANGE_PREFIX_RE = /^\s*(\d{1,5})\s*-\s*(\d{1,5})\s+(.+)$/;
const CIVIC_PREFIX_RE = /^\s*(\d{1,5})\s+(.+)$/;

/** Detect Quebec apartment/unit suffix: "..., apt 4", "...# 12", "..., bureau 200" */
const UNIT_SUFFIX_RE = /(?:,\s*|\s+)(?:apt\.?|appartement|app\.?|#|unit[ée]?|suite|bureau|local|loft|porte)\s*([\w-]+)\s*$/i;

const PROVINCE_NORMALIZE: Record<string, string> = {
  "QU[ÉE]BEC": "QC", "QUEBEC": "QC", "QUÉBEC": "QC", "QC": "QC",
  "ONTARIO": "ON", "ON": "ON",
  "NEW BRUNSWICK": "NB", "NB": "NB",
  "NOVA SCOTIA": "NS", "NS": "NS",
  "MANITOBA": "MB", "MB": "MB",
  "ALBERTA": "AB", "AB": "AB",
};

function normalizeProvince(raw: string): string | null {
  const u = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (PROVINCE_NORMALIZE[u]) return PROVINCE_NORMALIZE[u];
  // Tolerate accented "QUÉBEC"
  if (/^QU[ÉE]BEC$/i.test(u)) return "QC";
  return null;
}

function normalizePostal(raw: string): { full: string; fsa: string } | null {
  const m = POSTAL_RE.exec(raw);
  if (!m) return null;
  const full = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
  return { full, fsa: m[1].toUpperCase() };
}

/** Pull province + postal off the END of a string and return the remainder. */
function strpProvincePostalSuffix(s: string): {
  rest: string;
  province: string | null;
  postal: string | null;
  postalFsa: string | null;
} {
  let working = s.trim();
  let province: string | null = null;
  let postal: string | null = null;
  let postalFsa: string | null = null;

  const postalMatch = POSTAL_RE.exec(working);
  if (postalMatch) {
    const norm = normalizePostal(postalMatch[0]);
    if (norm) { postal = norm.full; postalFsa = norm.fsa; }
    working = (working.slice(0, postalMatch.index) + working.slice(postalMatch.index + postalMatch[0].length)).trim();
    working = working.replace(/[,\s]+$/, "").trim();
  }

  // Province may now be at the end
  const provMatch = working.match(new RegExp(`(?:,\\s*)?${PROVINCE_RE.source}\\s*$`, "i"));
  if (provMatch) {
    province = normalizeProvince(provMatch[1]);
    working = working.slice(0, provMatch.index).replace(/[,\s]+$/, "").trim();
  }

  return { rest: working, province, postal, postalFsa };
}

export function parseQuebecAddress(rawInput: string | null | undefined): ParsedAddress {
  const empty: ParsedAddress = {
    raw: rawInput ?? "",
    civicNumber: null, civicRange: null, streetName: null, unit: null,
    city: null, province: null, postal: null, postalFsa: null,
  };
  if (!rawInput) return empty;
  const raw = rawInput.trim();
  if (!raw) return empty;

  // 1. Strip postal + province from the suffix.
  const stripped = strpProvincePostalSuffix(raw);
  let working = stripped.rest;

  // 2. Pull off a unit suffix if present (",apt 4" / ",bureau 200" / "#12" at end).
  let unit: string | null = null;
  const unitSuffix = UNIT_SUFFIX_RE.exec(working);
  if (unitSuffix) {
    unit = unitSuffix[1];
    working = working.slice(0, unitSuffix.index).trim();
  }

  // 3. The last comma-separated token is usually the city. We split on the LAST comma.
  let city: string | null = null;
  const lastCommaIdx = working.lastIndexOf(",");
  let streetPart = working;
  if (lastCommaIdx >= 0) {
    streetPart = working.slice(0, lastCommaIdx).trim();
    city = working.slice(lastCommaIdx + 1).trim() || null;
  }

  // 4. Detect civic number / range / unit-prefix at the START of streetPart.
  let civicNumber: string | null = null;
  let civicRange: string | null = null;
  let streetName: string | null = null;

  // Try unit-prefix form first ("408 - 1020 Rue Levert"): only when there's a
  // space-padded dash. We detect it by re-running the regex on the ORIGINAL.
  const dashSpaced = /^\s*(\d{1,5})\s+-\s+(\d{1,5})\s+(.+)$/.exec(streetPart);
  if (dashSpaced) {
    unit = unit ?? dashSpaced[1];
    civicNumber = dashSpaced[2];
    streetName = dashSpaced[3].trim();
  } else {
    const rangeMatch = CIVIC_RANGE_PREFIX_RE.exec(streetPart);
    if (rangeMatch) {
      const left = parseInt(rangeMatch[1], 10);
      const right = parseInt(rangeMatch[2], 10);
      // Apartment-prefix form (no spaces): "300-150 rue Grant" where left > right
      // (the unit number is larger than the civic, a classic Québec pattern).
      // Heuristic: left > right AND left is ≤ 4 digits → treat left as unit, right as civic.
      if (left > right && rangeMatch[1].length <= 4) {
        unit = unit ?? rangeMatch[1];
        civicNumber = rangeMatch[2];
        streetName = rangeMatch[3].trim();
      } else {
        // True civic range: "189-197 Rue Desjardins Nord" (left ≤ right)
        civicRange = `${rangeMatch[1]}-${rangeMatch[2]}`;
        civicNumber = rangeMatch[1];
        streetName = rangeMatch[3].trim();
      }
    } else {
      const civicMatch = CIVIC_PREFIX_RE.exec(streetPart);
      if (civicMatch) {
        civicNumber = civicMatch[1];
        streetName = civicMatch[2].trim();
      } else {
        // No civic prefix → either incomplete address (just "BROMONT QC J2L 2X5")
        // or a city-only string.
        // If streetPart is empty AND city looks like a city, it's incomplete.
        if (!streetPart && city) {
          // The whole input was "city + province + postal" — definitely incomplete.
          return { ...empty, raw, city, province: stripped.province, postal: stripped.postal, postalFsa: stripped.postalFsa };
        }
        // Otherwise we have a non-numeric prefix. We treat it as no civic number.
      }
    }
  }

  // If we never found a comma, see if the city is the last word(s) before the
  // (already-stripped) province/postal. We bail out conservatively here: the
  // pre-flight gate will reject anything missing a city.
  if (!city && streetName) {
    // "3720 Avenue Kent Montréal" — try to peel a trailing single-word city.
    // We don't try this aggressively because it's error-prone.
    // Leave city = null; pre-flight will fail.
  }

  return {
    raw,
    civicNumber,
    civicRange,
    streetName,
    unit,
    city,
    province: stripped.province,
    postal: stripped.postal,
    postalFsa: stripped.postalFsa,
  };
}

// ── Helpers used elsewhere ───────────────────────────────────────────────────

/** Strip diacritics + lowercase for comparison. */
export function foldText(s: string | null | undefined): string {
  if (!s) return "";
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** Levenshtein distance (small strings only). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** Is a parsed address considered usable for a search? */
export function isAddressSearchable(p: ParsedAddress): boolean {
  return Boolean(p.civicNumber && p.streetName && p.city && p.postal);
}

/**
 * Derive the FSA (first 3 chars of postal code) from a raw postal string.
 * Returns null if the input is empty or not a valid Canadian FSA prefix.
 */
export function fsaFromPostal(postal: string | null | undefined): string | null {
  if (!postal) return null;
  const cleaned = postal.toUpperCase().replace(/\s+/g, "");
  if (cleaned.length < 3) return null;
  const fsa = cleaned.slice(0, 3);
  if (!/^[A-CEGHJ-NPR-TVXY]\d[A-CEGHJ-NPR-TV-Z]$/.test(fsa)) return null;
  return fsa;
}
