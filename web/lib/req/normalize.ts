/**
 * REQ entity name normalization helpers.
 *
 * Normalization steps for company / entity names:
 *   1. Handle null/empty → return empty string
 *   2. Lowercase
 *   3. NFD decomposition + strip combining diacritics (é→e, à→a, ô→o, etc.)
 *   4. Strip known legal suffixes (order matters — strip longest first to avoid partial matches)
 *   5. Remove residual punctuation (keep digits and letters)
 *   6. Collapse whitespace + trim
 *
 * Numbered companies (e.g. "9123-4567 QUÉBEC INC") retain the leading digit
 * sequence as their canonical NEQ-style identifier: "9123 4567 quebec".
 */

// Suffixes to strip, in descending length order so longer multi-word suffixes
// are matched before shorter subsets (e.g. "SOCIETE EN NOM" before "SOCIETE").
const LEGAL_SUFFIXES: RegExp = new RegExp(
  "\\b(" +
    [
      "SOCIETE EN NOM COLLECTIF",
      "SOCIETE EN COMMANDITE SIMPLE",
      "SOCIETE PAR ACTIONS",
      "INCORPOREE",
      "ENREGISTREE",
      "SOCIETE",
      "LTEE",
      "LTÉE",
      "SENC",
      "SCS",
      "INC",
      "LTD",
      "ENR",
    ]
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|") +
    ")\\b",
  "g",
);

/**
 * Normalize an entity (company) name for fuzzy comparison.
 *
 * Returns empty string for null/undefined/empty input.
 */
export function normalizeEntityName(s: string | null | undefined): string {
  if (!s) return "";

  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(LEGAL_SUFFIXES, " ") // strip legal suffixes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // non-alphanumeric → space
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

/**
 * Normalize a director's full name (personal name, not a company name).
 *
 * Steps:
 *   1. Lowercase
 *   2. NFD + strip diacritics
 *   3. Remove non-alphanumeric characters (keep spaces)
 *   4. Collapse whitespace + trim
 *
 * Returns empty string for null/undefined/empty input.
 */
export function normalizePersonName(s: string | null | undefined): string {
  if (!s) return "";

  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the FSA (first 3 characters of a Canadian postal code) from a
 * raw address string or postal code field. Returns null if not found.
 */
export function extractFsa(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/\b([A-Za-z]\d[A-Za-z])\b/);
  return match ? match[1].toUpperCase() : null;
}
