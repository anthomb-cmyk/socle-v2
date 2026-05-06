// Format A parser — Longueuil/Sherbrooke style.
// One row per (property, owner) pair: properties with N owners produce N rows
// that share the same address/matricule but differ in owner columns.
// Common columns:
//   - Adresse, Ville, Province, CodePostal
//   - Matricule
//   - Nb logements / Logements
//   - Évaluation totale, Évaluation terrain, Évaluation bâtiment, Année éval.
//   - Année construction
//   - Nom propriétaire, Adresse propriétaire, Téléphone propriétaire
//   - (sometimes) Type de propriétaire, Part %

import type { ParsedRow, ParsedOwner, ParsedProperty, ContactKind } from "./types.ts";
import { extractPhonesFromValue } from "./phone-utils.ts";
import { llmClassifyOwnerKind } from "@/lib/llm/owner-kind-fallback";

function getCol(row: Record<string, unknown>, ...patterns: RegExp[]): string {
  for (const key of Object.keys(row)) {
    const norm = key.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const re of patterns) {
      if (re.test(norm)) {
        const v = row[key];
        if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
      }
    }
  }
  return "";
}

function getNum(row: Record<string, unknown>, ...patterns: RegExp[]): number | undefined {
  const s = getCol(row, ...patterns);
  if (!s) return undefined;
  const n = parseFloat(s.replace(/[\s,$]/g, "").replace(",", "."));
  return isNaN(n) ? undefined : n;
}

function classifyOwner(name: string): ContactKind {
  if (!name) return "unknown";
  if (/^\d{4}[\s\-]\d{4}\s+(qu[eé]bec|qc|inc)/i.test(name)) return "numbered_co";
  const lower = name.toLowerCase();
  if (/\bfiducie\b/.test(lower)) return "trust";
  if (/\b(inc\.?|ltée|ltee|ltd\.?|s\.?e\.?n\.?c\.?|llc|corp|gestion|immobili[èe]re|holding|investissement|services?\b)\b/.test(lower)) return "company";
  if (/[a-zA-ZÀ-ÿ]+,\s*[a-zA-ZÀ-ÿ]+/.test(name)) return "person";
  if (/[a-zA-ZÀ-ÿ]+\s+[a-zA-ZÀ-ÿ]+/.test(name)) return "person";
  return "unknown";
}

/** Classify an owner name; if the regex returns "unknown" and llmFallback is
 *  enabled, call Haiku as a best-effort fallback.
 *  Returns "unknown" when both regex and LLM cannot determine the kind. */
export async function classifyOwnerWithFallback(
  name: string,
  opts: { llmFallback?: boolean; leadId?: string } = {},
): Promise<ContactKind> {
  const kind = classifyOwner(name);
  if (kind !== "unknown" || opts.llmFallback === false) return kind;
  const llmKind = await llmClassifyOwnerKind(name, { leadId: opts.leadId });
  return llmKind ?? "unknown";
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s|-|')(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
}

function splitPersonName(full: string): { first?: string; last?: string } {
  const t = full.trim();
  if (!t) return {};
  const comma = t.split(/,\s*/);
  if (comma.length === 2) return { last: titleCase(comma[0]), first: titleCase(comma[1]) };
  const parts = t.split(/\s+/);
  if (parts.length >= 2) return { first: titleCase(parts[0]), last: titleCase(parts.slice(1).join(" ")) };
  return { last: titleCase(t) };
}

function parsePropertyFrom(row: Record<string, unknown>): ParsedProperty {
  return {
    address: getCol(row, /^adresse$/, /immeuble.*adresse/, /^address$/) || "(unknown)",
    city: getCol(row, /^ville$/, /^city$/, /municipalite/) || null,
    province: getCol(row, /^province$/) || "QC",
    postal_code: getCol(row, /code\s*postal/, /postal\s*code/) || undefined,
    matricule: getCol(row, /matricule/) || undefined,
    cadastre: getCol(row, /cadastre/) || undefined,
    year_built: getNum(row, /annee.*construction/, /year.*built/),
    num_units: getNum(row, /logements?/, /nb.*units?/, /^units?$/),
    evaluation_total: getNum(row, /evaluation.*total/, /valeur.*total/),
    evaluation_land: getNum(row, /evaluation.*terrain/, /valeur.*terrain/),
    evaluation_bldg: getNum(row, /evaluation.*bati/, /valeur.*bati/),
    evaluation_year: getNum(row, /evaluation.*annee/, /annee.*evaluation/),
    raw_role_row: row,
  };
}

function parseOwnerFrom(row: Record<string, unknown>): ParsedOwner | null {
  const name = getCol(row, /^nom\s+proprietaire/, /proprietaire\s+nom/, /^owner\s+name/, /^owner$/);
  if (!name) return null;
  const phone = getCol(row, /telephone\s+proprietaire/, /tel\s+proprietaire/, /^telephone$/, /owner.*phone/);
  const addr = getCol(row, /adresse\s+proprietaire/, /proprietaire\s+adresse/, /mailing\s+address/);
  const sharePct = getNum(row, /^part/, /share.*pct/);

  const kind = classifyOwner(name);
  const owner: ParsedOwner = {
    kind,
    full_name: name,
    phones: extractPhonesFromValue(phone),
    source_columns: { phone: phone ? "Téléphone propriétaire" : undefined, address: addr ? "Adresse propriétaire" : undefined },
    share_pct: sharePct,
  };
  if (kind === "person") {
    const np = splitPersonName(name);
    owner.first_name = np.first;
    owner.last_name = np.last;
  } else if (kind === "company" || kind === "numbered_co" || kind === "trust") {
    owner.company_name = name;
  }
  if (addr) owner.mailing_address = addr;
  return owner;
}

/**
 * Format A: each input row has 1 property + 1 owner. We group rows by
 * (matricule || address+city) so a property with 3 owners produces 1
 * ParsedRow with 3 owners.
 */
export function parseFormatA(rawRows: Record<string, unknown>[]): ParsedRow[] {
  const groups = new Map<string, ParsedRow>();

  rawRows.forEach((row, idx) => {
    const property = parsePropertyFrom(row);
    const key = property.matricule
      ? `m:${property.matricule}`
      : `a:${property.address}|${property.city ?? ""}`;

    if (!groups.has(key)) {
      groups.set(key, {
        row_number: idx + 1,
        property,
        owners: [],
        errors: property.address === "(unknown)" ? ["missing address"] : [],
      });
    }
    const group = groups.get(key)!;
    const owner = parseOwnerFrom(row);
    if (owner) group.owners.push(owner);
  });

  // Final pass: flag groups with no owners
  return [...groups.values()].map(g => ({
    ...g,
    errors: g.owners.length === 0 ? [...g.errors, "no owners detected"] : g.errors,
  }));
}
