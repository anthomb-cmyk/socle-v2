// JS-side trigram similarity for typo tolerance. We can't reach pg_trgm via
// PostgREST without an RPC (and migrations are gated), so we score in memory.
// Used as a fallback when exact token matching returns nothing.

function trigrams(value: string): Set<string> {
  const normalized = ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const set = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    set.add(normalized.slice(i, i + 3));
  }
  return set;
}

export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  // Jaccard variant — matches Postgres pg_trgm.similarity behavior closely.
  return shared / (ta.size + tb.size - shared);
}

export function fuzzyRankRows<T extends Record<string, unknown>>(
  rows: T[],
  query: string,
  fields: (keyof T)[],
  threshold = 0.25,
): Array<{ row: T; score: number; matchedField: keyof T }> {
  const results: Array<{ row: T; score: number; matchedField: keyof T }> = [];
  for (const row of rows) {
    let best = 0;
    let bestField: keyof T = fields[0];
    for (const f of fields) {
      const value = row[f];
      if (typeof value !== "string") continue;
      const score = trigramSimilarity(query, value);
      if (score > best) {
        best = score;
        bestField = f;
      }
    }
    if (best >= threshold) results.push({ row, score: best, matchedField: bestField });
  }
  return results.sort((a, b) => b.score - a.score);
}
