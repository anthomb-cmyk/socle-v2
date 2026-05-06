// Name normalization helpers for the enrichment pipeline.
//
// Used by Stage 0.5 (cross-contact portfolio match) to compare owner names
// across contacts regardless of accent, casing, or punctuation differences.

/**
 * Normalize a personal or company name for fuzzy comparison.
 *
 * Steps:
 *   1. Lowercase
 *   2. Strip diacritics via NFD decomposition (é → e, à → a, etc.)
 *   3. Replace all non-alphanumeric characters with a space
 *   4. Collapse multiple spaces to one and trim
 *
 * Returns null when the input is null or the normalized result is empty string.
 */
export function normalizeName(s: string | null): string | null {
  if (s === null) return null;
  const normalized = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")      // non-alphanumeric → space
    .replace(/\s+/g, " ")             // collapse whitespace
    .trim();
  return normalized.length > 0 ? normalized : null;
}
