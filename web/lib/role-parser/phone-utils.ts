// NANP-only phone normalization. E.164 form: "+1XXXXXXXXXX" (12 chars total).

const PHONE_TEXT_RE = /(?:\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})\b/g;
const PHONE_COMPACT_RE = /\b1?(\d{3})(\d{3})(\d{4})\b/g;
const VALID_NANP_AREA = /^[2-9][0-8]\d$/;
const VALID_NANP_EXCH = /^[2-9]\d\d$/;

// Reject things that look like Quebec rôle codes but aren't phones.
const LOOKS_LIKE_MATRICULE = /^\s*\d{4}[\s\-]\d{2}[\s\-]\d{4}[\s\-]\d[\s\-]\d{3}[\s\-]\d{4}\s*$/;
const LOOKS_LIKE_CADASTRE = /^\s*\d{7,}\s*$/;
const LOOKS_LIKE_NUMBERED_CO = /^\s*\d{4}[\s\-]\d{4}\s+(?:qu[eé]bec|que|qc|inc)\b/i;

export function isValidNanp(area: string, exch: string, sub: string): boolean {
  return VALID_NANP_AREA.test(area) && VALID_NANP_EXCH.test(exch) && /^\d{4}$/.test(sub);
}

export function toE164(area: string, exch: string, sub: string): string {
  return `+1${area}${exch}${sub}`;
}

export function formatDisplay(e164: string): string {
  // "+1XXXXXXXXXX" → "(XXX) XXX-XXXX"
  if (!/^\+1\d{10}$/.test(e164)) return e164;
  return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
}

/**
 * Extract all valid NANP phone numbers from any text/value, deduped, in E.164.
 * Rejects matricules, cadastres, numbered-company prefixes.
 */
export function extractPhonesFromValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const txt = typeof value === "string" ? value : String(value);
  if (!txt.trim()) return [];

  // Bail out if the WHOLE string looks like something that isn't a phone
  if (LOOKS_LIKE_MATRICULE.test(txt) || LOOKS_LIKE_CADASTRE.test(txt) || LOOKS_LIKE_NUMBERED_CO.test(txt)) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];

  // Try formatted shapes first
  for (const m of txt.matchAll(PHONE_TEXT_RE)) {
    if (isValidNanp(m[1], m[2], m[3])) {
      const e = toE164(m[1], m[2], m[3]);
      if (!seen.has(e)) { seen.add(e); out.push(e); }
    }
  }

  if (out.length === 0) {
    // Fall back to compact 10-digit shapes (e.g. "5145551234")
    for (const m of txt.matchAll(PHONE_COMPACT_RE)) {
      if (isValidNanp(m[1], m[2], m[3])) {
        const e = toE164(m[1], m[2], m[3]);
        if (!seen.has(e)) { seen.add(e); out.push(e); }
      }
    }
  }

  return out;
}

/**
 * Column-name detection — works for compact French/English variants including
 * underscore-prefixed (Format B) columns like "Propriétaire1_Téléphone".
 * Normalizes the column name (strip diacritics + digits + underscores) before testing.
 */
export function isPhoneColumnName(key: string): boolean {
  const normalized = String(key || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")          // strip diacritics
    .replace(/[_\-0-9]+/g, " ")
    .toLowerCase();
  return /(tel|phone|telephone|mobile|cell|fax|numero|number)/.test(normalized);
}

export function isAddressColumnName(key: string): boolean {
  const normalized = String(key || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_\-0-9]+/g, " ")
    .toLowerCase();
  return /(adresse|address|mailing|courrier)/.test(normalized);
}
