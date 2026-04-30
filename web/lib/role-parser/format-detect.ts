import type { RoleFormat } from "./types.ts";

/**
 * Detect Quebec rôle format from header columns.
 *
 * Format B (Granby): compact-indexed. Has columns like "Propriétaire1_Téléphone",
 * "Propriétaire2_Adresse" — all info per owner concatenated with underscore-index.
 *
 * Format A (Longueuil/Sherbrooke): one row per (property, owner). Owner info
 * spread across columns like "Nom propriétaire", "Adresse propriétaire".
 *
 * Format C (Quebec City variant): TBD.
 *
 * Format D (Prospection / phone list): not a rôle; just owner+phone+address pairs.
 */
export function detectFormat(headers: string[]): RoleFormat {
  const norm = headers.map(h =>
    String(h || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
  );

  const has = (re: RegExp) => norm.some(h => re.test(h));

  // Format B: "proprietaire1_telephone", "proprietaire2_adresse" etc.
  if (has(/proprietaire\s*\d+\s*[_\-\s]+(telephone|adresse|nom)/)) return "role_b";

  // Format A: separate "nom proprietaire" + "telephone" columns, one row per owner
  if (has(/^nom\s+proprietaire/) || has(/proprietaire\s+nom/)) return "role_a";

  // Format D: prospection list — has "telephone" + "nom" + "adresse" but no matricule
  if (has(/^telephone$/) && has(/^nom$/) && !has(/matricule/)) return "role_d";

  return "unknown";
}
