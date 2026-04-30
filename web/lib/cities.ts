// City normalization. Mirror of supabase normalize_city() SQL function.
// VICTORIAVILLE → Victoriaville · ST-HYACINTHE → Saint-Hyacinthe · STE FOY → Sainte-Foy
export function normalizeCity(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().replace(/\s+/g, " ");
  if (!s) return null;
  s = s.replace(/^st[\.\-\s]/i, "saint-").replace(/^ste[\.\-\s]/i, "sainte-");
  s = s.replace(/-/g, " ");
  // Title-case
  s = s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase());
  s = s.replace(/ /g, "-");
  return s;
}
