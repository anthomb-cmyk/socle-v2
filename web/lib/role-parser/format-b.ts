// Format B parser — Granby-style compact-indexed rôle.
// One row per property, with owners enumerated as Propriétaire1_*, Propriétaire2_*, ...

import type { ParsedRow, ParsedOwner, ParsedProperty, ContactKind } from "./types.ts";
import { extractPhonesFromValue } from "./phone-utils.ts";

// ─── helpers ────────────────────────────────────────────────────────────
function getCol(row: Record<string, unknown>, ...patterns: RegExp[]): string {
  for (const key of Object.keys(row)) {
    const norm = key.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const re of patterns) {
      if (re.test(norm)) {
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
  const n = parseFloat(s.replace(/[\s,$]/g, "").replace(",", "."));
  return isNaN(n) ? undefined : n;
}

function classifyOwner(name: string): ContactKind {
  if (!name) return "unknown";
  // Numbered Québec companies first — they look like "9999-9999 Québec Inc."
  // and would otherwise be matched as plain "company" by the inc/ltée/etc. regex.
  if (/^\d{4}[\s\-]\d{4}\s+(qu[eé]bec|qc|inc)/i.test(name)) return "numbered_co";
  const lower = name.toLowerCase();
  if (/\bfiducie\b/.test(lower)) return "trust";
  if (/\b(inc\.?|ltée|ltee|ltd\.?|s\.?e\.?n\.?c\.?|llc|corp|gestion|immobili[èe]re|holding|investissement|services?\b)\b/.test(lower)) {
    return "company";
  }
  if (/[a-zA-ZÀ-ÿ]+,\s*[a-zA-ZÀ-ÿ]+/.test(name)) return "person";   // "Tremblay, Jean"
  if (/[a-zA-ZÀ-ÿ]+\s+[a-zA-ZÀ-ÿ]+/.test(name)) return "person";    // "Jean Tremblay"
  return "unknown";
}

function splitPersonName(full: string): { first?: string; last?: string } {
  const trimmed = full.trim();
  if (!trimmed) return {};
  // "TREMBLAY, JEAN" → last=Tremblay, first=Jean
  const comma = trimmed.split(/,\s*/);
  if (comma.length === 2) {
    return { last: titleCase(comma[0]), first: titleCase(comma[1]) };
  }
  // "Jean Tremblay" → first=Jean, last=Tremblay
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return { first: titleCase(parts[0]), last: titleCase(parts.slice(1).join(" ")) };
  }
  return { last: titleCase(trimmed) };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s|-|')(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
}

function parseMailingAddress(addr: string): { street?: string; city?: string; postal?: string } {
  if (!addr) return {};
  // Typical: "200-1350 rue Sherbrooke O Montréal (Québec) H3G1J1 Canada"
  const postal = addr.match(/\b([A-Z]\d[A-Z][\s\-]?\d[A-Z]\d)\b/i);
  const city = addr.match(/([A-Za-zÀ-ÿ\-'\s]+)\s*\(qu[eé]bec\)/i);
  return {
    street: addr.split(/\s+(?=[A-Za-zÀ-ÿ\-']+\s*\(qu[eé]bec\))/i)[0]?.trim(),
    city: city ? titleCase(city[1].trim()) : undefined,
    postal: postal ? postal[1].toUpperCase().replace(/[\s\-]/g, "") : undefined,
  };
}

// ─── main parser ────────────────────────────────────────────────────────
export function parseFormatB(rawRows: Record<string, unknown>[]): ParsedRow[] {
  return rawRows.map((row, idx) => {
    const errors: string[] = [];

    // Property side
    const address = getCol(row, /^adresse$/, /immeuble.*adresse/, /^address$/);
    const city = getCol(row, /^ville$/, /^city$/, /municipalite/);
    const matricule = getCol(row, /matricule/);
    const numUnits = getNum(row, /logements?/, /nb.*units?/, /^units?$/);
    const yearBuilt = getNum(row, /annee.*construction/, /year.*built/);
    const evalTotal = getNum(row, /evaluation.*total/, /valeur.*total/);
    const evalLand = getNum(row, /evaluation.*terrain/, /valeur.*terrain/);
    const evalBldg = getNum(row, /evaluation.*batiment/, /valeur.*batiment/);
    const evalYear = getNum(row, /evaluation.*annee/, /annee.*evaluation/);

    if (!address) errors.push("missing address");

    const property: ParsedProperty = {
      address: address || "(unknown)",
      city: city || null,
      matricule: matricule || undefined,
      num_units: numUnits,
      year_built: yearBuilt,
      evaluation_total: evalTotal,
      evaluation_land: evalLand,
      evaluation_bldg: evalBldg,
      evaluation_year: evalYear,
      raw_role_row: row,
    };

    // Owners side: scan for Propriétaire{N}_*  columns
    const ownerKeys = new Map<number, Record<string, string>>();
    for (const key of Object.keys(row)) {
      const norm = key.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const m = norm.match(/proprietaire\s*(\d+)\s*[_\-\s]+(.+)$/);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      const subKey = m[2].trim();
      if (!ownerKeys.has(n)) ownerKeys.set(n, {});
      const v = row[key];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        ownerKeys.get(n)![subKey] = String(v).trim();
      }
    }

    const owners: ParsedOwner[] = [];
    for (const [, sub] of [...ownerKeys.entries()].sort((a, b) => a[0] - b[0])) {
      const name = sub["nom"] || sub["name"] || "";
      const phone = sub["telephone"] || sub["phone"] || sub["tel"] || "";
      const addr = sub["adresse"] || sub["address"] || sub["mailing"] || "";
      if (!name && !phone && !addr) continue;

      const kind = classifyOwner(name);
      const phones = extractPhonesFromValue(phone);
      const mailing = parseMailingAddress(addr);

      const owner: ParsedOwner = {
        kind,
        full_name: name || "(unknown)",
        phones,
        source_columns: { phone: phone ? "Propriétaire_Téléphone" : undefined, address: addr ? "Propriétaire_Adresse" : undefined },
      };

      if (kind === "person") {
        const np = splitPersonName(name);
        owner.first_name = np.first;
        owner.last_name = np.last;
      } else if (kind === "company" || kind === "numbered_co" || kind === "trust") {
        owner.company_name = name;
      }

      owner.mailing_address = mailing.street || addr || undefined;
      owner.mailing_city = mailing.city;
      owner.mailing_postal = mailing.postal;

      owners.push(owner);
    }

    if (owners.length === 0) errors.push("no owners detected");

    return {
      row_number: idx + 1,
      property,
      owners,
      errors,
    };
  });
}
