import type { RoleFormat } from "./types.ts";

/**
 * Detect Quebec rôle format from header columns.
 *
 * Format B (Granby/StHyacinthe/Waterloo/Victoriaville/Magog): compact-indexed.
 *   Columns prefixed with owner index: "Propriétaire1_Nom", "Propriétaire1_Téléphone", etc.
 *
 * Format A (Longueuil-style): one row per (property, owner). Owner info
 *   spread across columns like "Nom propriétaire", "Adresse propriétaire".
 *
 * Format C (Sherbrooke-style): one row per property, owners in suffix-indexed columns.
 *   Owner 1 has bare columns "Propriétaire", "Téléphone", "Adresse Postale".
 *   Owners 2-N: "Propriétaire 2", "Téléphone 2", "Adresse Postale 2", etc.
 *   Distinguished from format B by absence of underscore-prefixed owner columns.
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

  // Format C (Sherbrooke): bare "Propriétaire" + "Téléphone" columns,
  // with suffix-indexed extras "Propriétaire 2", "Téléphone 2", etc.
  // Must have a matricule column to distinguish from format D.
  if (has(/^proprietaire$/) && has(/^telephone$/) && has(/matricule/)) return "role_c";

  // Format D: prospection list — has "telephone" + "nom" + "adresse" but no matricule
  if (has(/^telephone$/) && has(/^nom$/) && !has(/matricule/)) return "role_d";

  return "unknown";
}
