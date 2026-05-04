// Format B parser — handles the two main Québec rôle XLSX formats:
//
//   B1 — Granby/StHyacinthe/Waterloo/Livraison-2 style:
//        Columns prefixed with owner index, e.g. "Propriétaire1_Nom",
//        "Propriétaire1_Téléphone", "Propriétaire2_Adresse", …
//
//   B2 — Longueuil/Sherbrooke rôle style:
//        Owner 1 has NO index: "Propriétaire", "Propriétaire Prénom",
//        "Propriétaire Nom", "Adresse postale", "Téléphone".
//        Owners 2-8 are prefix-named: "Propriétaire 2", "Propriétaire 2 Prénom",
//        but address/phone/statut are SUFFIX-indexed: "Adresse postale 2",
//        "Téléphone 2", "Statut aux fins d'imposition scolaire 2".
//
//   The parser handles both patterns and merges them into a unified owner list.

import type { ParsedRow, ParsedOwner, ParsedProperty, ContactKind } from "./types.ts";
import { extractPhonesFromValue } from "./phone-utils.ts";

// ─── helpers ──────────────────────────────────────────────────────────────────

function normKey(s: unknown): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Return the first non-empty column value whose normalised key matches any pattern.
 */
function getCol(row: Record<string, unknown>, ...patterns: RegExp[]): string {
  for (const key of Object.keys(row)) {
    const n = normKey(key);
    for (const re of patterns) {
      if (re.test(n)) {
        const v = row[key];
        if (v !== null && v !== undefined && String(v).trim() !== "") {
          return String(v).trim();
        }
      }
    }
  }
  return "";
}

function getNum(row: Record<string, unknown>, ...patterns: RegExp[]): number | undefined {
  const s = getCol(row, ...patterns);
  if (!s) return undefined;
  // Strip currency symbols, spaces, $ signs; replace comma-decimal
  const cleaned = s.replace(/[^\d.,\-]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}

export function classifyOwner(name: string): ContactKind {
  if (!name) return "unknown";
  if (/^\d{4}[\s\-]\d{4}\s+(qu[eé]bec|qc|inc)/i.test(name)) return "numbered_co";
  if (/^\d{4}[\s\-]\d{4}\s+inc/i.test(name)) return "numbered_co";
  const lower = name.toLowerCase();
  if (/\bfiducie\b/.test(lower)) return "trust";
  if (/\b(inc\.?|ltée|ltee|ltd\.?|s\.?e\.?n\.?c\.?|llc|corp\.?|gestion|immobili[èe]re?|holding|investissement|services?\s|placements?\s|constructions?\s|propriet[eé]s?\s|locations?\s|gestions?\s|entreprises?\s|associes?\s)\b/.test(lower)) {
    return "company";
  }
  if (/[a-zA-ZÀ-ÿ]+,\s*[a-zA-ZÀ-ÿ]+/.test(name)) return "person";
  if (/[a-zA-ZÀ-ÿ]+\s+[a-zA-ZÀ-ÿ]+/.test(name)) return "person";
  return "unknown";
}

function splitPersonName(full: string): { first?: string; last?: string } {
  const t = full.trim();
  if (!t) return {};
  const comma = t.split(/,\s*/);
  if (comma.length === 2) {
    return { last: titleCase(comma[0]), first: titleCase(comma[1]) };
  }
  const parts = t.split(/\s+/);
  if (parts.length >= 2) {
    return { first: titleCase(parts[0]), last: titleCase(parts.slice(1).join(" ")) };
  }
  return { last: titleCase(t) };
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.toLowerCase().replace(/(^|\s|-|')(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
}

/**
 * Parse a mailing address string into { street, city, postal }.
 * Handles two common Québec formats:
 *   "1755 chemin des Prairies, Brossard, QC, J4X 1G5"   ← comma + province abbrev
 *   "200 rue Principale Montréal (Québec) H2X 1Y4"       ← (Québec) style
 */
function parseMailingAddress(addr: string): { street?: string; city?: string; postal?: string } {
  if (!addr || /^non\s+disponible$/i.test(addr.trim())) return {};

  const postalM = addr.match(/\b([A-Z]\d[A-Z][\s]?\d[A-Z]\d)\b/i);
  const postal = postalM ? postalM[1].toUpperCase().replace(/\s/g, "") : undefined;

  // Format: ", City, QC" or ", City, Québec" or ", City QC"
  const qcCommaM = addr.match(/,\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{1,40}?)\s*,\s*(?:QC|QU[ÉE]BEC|QUE)\b/i);
  // Format: "City (Québec)"
  const qcParenM = addr.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{1,40}?)\s*\(qu[eé]bec\)/i);

  const cityM = qcCommaM || qcParenM;
  const city = cityM ? titleCase(cityM[1].trim()) : undefined;

  let street: string | undefined;
  if (cityM?.index !== undefined) {
    street = addr.substring(0, cityM.index).replace(/,\s*$/, "").trim() || undefined;
  } else {
    street = addr.trim() || undefined;
  }

  return { street: street || undefined, city, postal };
}

/**
 * Remove trailing ", City, Province, Postal" from a full property address string.
 * E.g. "3661-3667, rue de Mont-Royal, Longueuil, QC, J4T 2G9"
 *   → "3661-3667, rue de Mont-Royal"
 */
function stripCityFromAddress(address: string, city: string | null): string {
  if (!address) return address;
  if (!city) {
    // Try to strip a trailing ", Word, QC, PostalCode" pattern generically
    return address
      .replace(/,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']+,\s*(?:QC|QU[ÉE]BEC|QUE)\b.*/i, "")
      .replace(/,\s*$/, "")
      .trim();
  }
  const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return address
    .replace(new RegExp(`,?\\s*${escapedCity}[\\s,].*$`, "i"), "")
    .replace(/,\s*$/, "")
    .trim() || address;
}

// ─── main parser ──────────────────────────────────────────────────────────────

export function parseFormatB(rawRows: Record<string, unknown>[]): ParsedRow[] {
  return rawRows.map((row, idx) => {
    const errors: string[] = [];

    // ── Property columns ──────────────────────────────────────────────────────

    // Address: prefer clean/preprocessed column, then raw "Adresse Immeuble"
    const rawAddress = getCol(row,
      /adresse.*immeuble.*clean/,   // "Adresse_Immeuble_clean"
      /adresses.*immeubles.*clean/, // "adresses immeubles clean"
      /^adresse.*clean$/,           // generic clean address
      /adresse.*immeuble/,          // "Adresse Immeuble" ← livraison-2 fix
      /immeuble.*adresse/,          // kept for backward compat
      /^adresse$/,                  // "Adresse" (Sherbrooke commercial)
      /^address$/,
    );

    const city = getCol(row,
      /^ville$/,
      /ville.*immeuble.*clean/,
      /^city$/,
      /^municipalite/,
      /ville.*immeuble/,
    );

    const postalCode = getCol(row,
      /code.*postal.*immeuble/,     // "Code Postal Immeuble", "code_postal_immeuble_clean"
      /code[_\s]*postal(?!e)/,      // "code_postal", "Code Postal" (avoid "adresse postale")
      /postal.*code/,
    ) || undefined;

    const matricule = getCol(row,
      /^matricule$/,
      /^matricule[_\s]batiment$/,
      /matricule/,
    ) || undefined;

    const cadastre = getCol(row,
      /cadastre(?!.*batiment)/,
      /cadastre/,
      /numero.*lot/,
      /lot.*cadastre/,
    ) || undefined;

    const numUnits = getNum(row,
      /nb.*total.*unit/,    // "Nb Total Unités"
      /^logements?$/,       // exact
      /logements?/,         // "Nb Logements", "Nombre de logements", "#logement"
      /nb.*logements?/,
      /nombre.*logements?/,
      /^units?$/,
    );

    const yearBuilt = getNum(row,
      /annee.*construction/,
      /year.*built/,
      /^annee\s*arrondi/,
    );

    // Eval total — prefer "Valeur de l'immeuble" (comes before "Valeur imposable…" in all files)
    const evalTotal = getNum(row,
      /valeur\s+de\s+l/,        // "Valeur de l'immeuble"
      /^valeur\s+immeuble$/,    // "Valeur Immeuble" (Trois-Rivières)
      /evaluation.*total/,
      /valeur.*total/,
      /valeur.*uniformis/,      // "Valeur uniformisée" (12 portes)
      /valeur.*fonci/,          // "Valeur fonciere" (12 portes)
    );
    const evalLand = getNum(row, /evaluation.*terrain/, /valeur.*terrain/);
    const evalBldg = getNum(row, /evaluation.*batiment/, /valeur.*bati/, /valeur.*batiment/);

    // Clean trailing city/province/postal from address field
    const address = stripCityFromAddress(rawAddress, city || null);

    if (!address) errors.push("missing address");

    const property: ParsedProperty = {
      address: address || "(unknown)",
      city: city || null,
      postal_code: postalCode,
      matricule,
      cadastre,
      num_units: numUnits,
      year_built: yearBuilt,
      evaluation_total: evalTotal,
      evaluation_land: evalLand,
      evaluation_bldg: evalBldg,
      raw_role_row: row,
    };

    // ── Owner columns ─────────────────────────────────────────────────────────
    //
    // Build a map: ownerIndex → { nom, prenom, nom_famille, statut, adresse, telephone }
    // Three sources merged in priority order:
    //   (A) Prefix-indexed: "Propriétaire1_Nom", "Propriétaire 2 Prénom", …
    //   (B) Suffix-indexed: "Adresse postale 2", "Téléphone 2", "Statut … 2"
    //   (C) Unnumbered owner 1: "Propriétaire", "Téléphone" (Longueuil B2 style)

    const ownerMap = new Map<number, Record<string, string>>();

    const getOwnerSub = (n: number): Record<string, string> => {
      if (!ownerMap.has(n)) ownerMap.set(n, {});
      return ownerMap.get(n)!;
    };
    const setField = (n: number, field: string, val: string) => {
      const sub = getOwnerSub(n);
      if (val && !sub[field]) sub[field] = val;
    };

    for (const key of Object.keys(row)) {
      const n = normKey(key);
      const v = row[key];
      if (v === null || v === undefined || String(v).trim() === "") continue;
      const val = String(v).trim();

      // (A) Prefix-indexed: "proprietaire N ..." or "proprietaireN_..."
      const prefixM = n.match(/^proprietaire\s*(\d+)\s*[_\-\s]+(.+)$/);
      if (prefixM) {
        const ownerIdx = parseInt(prefixM[1], 10);
        const subKey = prefixM[2].trim();
        setField(ownerIdx, subKey, val);
        continue;
      }

      // (B) Suffix-indexed: field ending in " N" or "_N"
      //   "Adresse postale 2", "Téléphone 2", "Statut ... 2", "Propriétaire 2"
      const suffixM = n.match(/^(.+?)[_\s]+(\d+)$/);
      if (suffixM) {
        const fieldNorm = suffixM[1].trim();
        const ownerIdx = parseInt(suffixM[2], 10);
        if (/^t[eé]l(ephone)?$|^phone$/.test(fieldNorm)) {
          setField(ownerIdx, "telephone", val);
        } else if (/^adresse\s*postale$/.test(fieldNorm)) {
          setField(ownerIdx, "adresse", val);
        } else if (/^statut/.test(fieldNorm)) {
          setField(ownerIdx, "statut", val);
        } else if (/^proprietaire$/.test(fieldNorm)) {
          // "Propriétaire 2" = owner 2's full name (no sub-key suffix)
          setField(ownerIdx, "full_name_raw", val);
        }
        continue;
      }
    }

    // (C) Unnumbered owner 1 — Longueuil B2 style (only if owner 1 not already found)
    if (!ownerMap.has(1)) {
      const name1 = getCol(row, /^proprietaire$/);
      if (name1) {
        // Use index 0 so it sorts before any "1" entries from other files
        setField(0, "nom", name1);
        const pr = getCol(row, /^proprietaire\s+prenom$/);
        const nm = getCol(row, /^proprietaire\s+nom$/);
        const te = getCol(row, /^t[eé]l[eé]phone$/);
        const ad = getCol(row, /^adresse\s+postale$/);
        const st = getCol(row, /^statut\s+aux/);
        if (pr) setField(0, "prenom", pr);
        if (nm) setField(0, "nom_famille", nm);
        if (te) setField(0, "telephone", te);
        if (ad) setField(0, "adresse", ad);
        if (st) setField(0, "statut", st);
      }
    }

    // Supplement owner 1 with Trois-Rivières-style clean name columns
    const owner1Sub = ownerMap.get(0) ?? ownerMap.get(1);
    if (owner1Sub) {
      const nomComplet = getCol(row, /^nom_?complet$/, /^nom.*complet$/);
      const prenomClean = getCol(row, /^prenom_?clean\s*$/, /^prenm_?clean\s*$/);
      const nomClean = getCol(row, /^nom_?clean\s*$/);
      if (nomComplet && !owner1Sub["nom"]) owner1Sub["nom"] = nomComplet;
      if (prenomClean && !owner1Sub["prenom"]) owner1Sub["prenom"] = prenomClean;
      if (nomClean && !owner1Sub["nom_famille"]) owner1Sub["nom_famille"] = nomClean;
    }

    // Merge full_name_raw → nom when nom is missing OR when nom looks like just
    // a last name (i.e. prenom is also set, meaning nom = last name only).
    // In Longueuil B2 format, "Propriétaire 2 Nom" = last name, but
    // "Propriétaire 2" (no suffix) = full name → prefer the full name.
    for (const [, sub] of ownerMap.entries()) {
      if (sub["full_name_raw"]) {
        if (!sub["nom"] || sub["prenom"]) {
          // Replace nom with the pre-composed full name; keep prenom/nom_famille
          // for first/last extraction downstream
          sub["full_name"] = sub["full_name_raw"];
        }
      }
    }

    // ── Build ParsedOwner list ─────────────────────────────────────────────────

    const rawOwners: ParsedOwner[] = [];

    for (const [, sub] of [...ownerMap.entries()].sort((a, b) => a[0] - b[0])) {
      // Priority: pre-composed full name > nom field > name
      const rawName = sub["full_name"] || sub["nom"] || sub["name"] || "";
      const phone = sub["telephone"] || sub["phone"] || sub["tel"] || "";
      const addr = sub["adresse"] || sub["address"] || sub["mailing"] || "";
      const prenom = (sub["prenom"] || "").trim();
      const nomFamille = (sub["nom_famille"] || "").trim();
      const statut = (
        sub["statut"] ||
        sub["statutimposition"] ||
        sub["statutimpositionscolaire"] ||
        ""
      ).trim();

      if (!rawName && !phone && !addr) continue;

      // Classify with statut context
      const isPersonStatut = /^personne\s+physique$|^physique$/i.test(statut);
      let kind: ContactKind;
      if (isPersonStatut) {
        kind = "person";
      } else {
        kind = classifyOwner(rawName);
      }

      const phones = extractPhonesFromValue(phone);
      const mailing = parseMailingAddress(addr);

      const owner: ParsedOwner = {
        kind,
        full_name: rawName || "(unknown)",
        phones,
        source_columns: {
          phone: phone ? "telephone_column" : undefined,
          address: addr ? "adresse_column" : undefined,
        },
        mailing_address: mailing.street || (addr && !/^non\s+disponible$/i.test(addr) ? addr : undefined) || undefined,
        mailing_city: mailing.city,
        mailing_postal: mailing.postal,
      };

      if (kind === "person") {
        // In Longueuil B2 format, "Propriétaire 2 Nom" → subKey "nom" = LAST NAME only,
        // and "Propriétaire 2 Prénom" → subKey "prenom" = FIRST NAME.
        // When prenom is present, treat "nom" as last-name even if "nom_famille" is absent.
        const lastName = (nomFamille || (prenom ? (sub["nom"] || "") : "")).trim();
        const composedName = [prenom, lastName].filter(Boolean).join(" ").trim();
        // Prefer pre-composed full_name (from full_name_raw), else composed, else rawName
        const bestFullName = sub["full_name"] || composedName || rawName;

        if (prenom || lastName) {
          owner.first_name = titleCase(prenom) || undefined;
          owner.last_name = titleCase(lastName) || undefined;
        } else {
          const np = splitPersonName(rawName);
          owner.first_name = np.first;
          owner.last_name = np.last;
        }
        owner.full_name = titleCase(bestFullName);
      } else if (kind === "company" || kind === "numbered_co" || kind === "trust") {
        owner.company_name = rawName;

        // For company-owned leads, "Propriétaire Prénom" / "Propriétaire Nom"
        // (or the Longueuil B2 fallback "sub.nom" when Prénom is present)
        // hold the DIRECTOR's name — separate from the inc name in the
        // "Propriétaire" column. Use it as full_name so callers see who
        // to ask for, not the inc name twice.
        const dirLast = (nomFamille || (prenom ? (sub["nom"] || "") : "")).trim();
        const directorName = [prenom, dirLast].filter(Boolean).join(" ").trim();
        if (directorName) {
          owner.full_name = titleCase(directorName);
          owner.first_name = titleCase(prenom) || undefined;
          owner.last_name = titleCase(dirLast) || undefined;
        } else {
          owner.full_name = rawName; // legacy fallback: no director info
        }

        // Longueuil B2: when a company has Prénom + Nom fields, those represent
        // the contact PERSON behind the company.  Add as a separate owner entry
        // immediately after the company so they appear linked.
        if (prenom || nomFamille) {
          const personName = [prenom, nomFamille].filter(Boolean).join(" ").trim();
          if (personName) {
            rawOwners.push(owner);
            rawOwners.push({
              kind: "person",
              full_name: titleCase(personName),
              first_name: titleCase(prenom) || undefined,
              last_name: titleCase(nomFamille) || undefined,
              phones: [],
              mailing_address: owner.mailing_address,
              mailing_city: owner.mailing_city,
              mailing_postal: owner.mailing_postal,
              source_columns: {},
            });
            continue;
          }
        }
      } else {
        owner.full_name = titleCase(rawName);
      }

      rawOwners.push(owner);
    }

    // Deduplicate by normalised name (handles Jun Xia Wang appearing as both
    // the company rep AND as a separate Propriétaire 2 in Longueuil files)
    const seenNames = new Set<string>();
    const owners: ParsedOwner[] = [];
    for (const o of rawOwners) {
      const dedupeKey = (
        o.kind !== "person" ? (o.company_name ?? o.full_name) : o.full_name
      ).toLowerCase().trim();
      if (!dedupeKey || seenNames.has(dedupeKey)) continue;
      seenNames.add(dedupeKey);
      owners.push(o);
    }

    if (owners.length === 0) errors.push("no owners detected");

    return { row_number: idx + 1, property, owners, errors };
  });
}
