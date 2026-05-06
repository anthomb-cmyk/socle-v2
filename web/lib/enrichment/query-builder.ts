// Layer B — Structured query builder (v3 enrichment redesign).
//
// Builds Brave queries from PARSED address fields, never raw concatenation.
// The property city is never appended (RC-1 fix). Maximum 4 deterministic
// variants; duplicates are dropped.
//
// Each emitted query carries metadata for the audit log.

import type { LeadContext, ParsedAddress } from "./types";

export interface BuiltQuery {
  query: string;
  /** Variant identifier, for the audit trail */
  variant: "addr_city_postal_phone" | "addr_postal_phone" | "addr_city_phone" | "owner_addr_city" | "company_city" | "company_postal" | "owner_city" | "owner_addr";
  /** Structured inputs that produced the query */
  inputs: Record<string, string | null>;
}

/** Quote a value for Brave when it contains spaces or punctuation. */
function q(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.trim();
  if (!t) return "";
  return /[\s'"]/.test(t) ? `"${t.replace(/"/g, "")}"` : t;
}

/** Build address queries from a PARSED mailing address.
 *
 *  Variants emitted (in priority order):
 *    1. "<civic> <street>" "<city>" "<postal>" téléphone
 *    2. "<civic> <street>" "<postal>"
 *    3. "<civic> <street>" "<city>" téléphone
 *    4. "<owner_or_company>" "<civic> <street>" "<city>"   (only if owner/company known)
 *
 *  We never emit `propertyCity` and we never emit raw concatenations.
 */
export function buildAddressQueries(parsed: ParsedAddress, ctx: LeadContext): BuiltQuery[] {
  const civic = parsed.civicNumber;
  const street = parsed.streetName;
  const city = parsed.city;
  const postal = parsed.postal;

  if (!civic || !street || !city || !postal) return [];

  const civicStreet = `${civic} ${street}`;
  const owner = ctx.companyName?.trim() || ctx.fullName?.trim() || null;

  const variants: BuiltQuery[] = [
    {
      variant: "addr_city_postal_phone",
      query: `${q(civicStreet)} ${q(city)} ${q(postal)} téléphone`,
      inputs: { civic, street, city, postal },
    },
    {
      variant: "addr_postal_phone",
      query: `${q(civicStreet)} ${q(postal)}`,
      inputs: { civic, street, postal },
    },
    {
      variant: "addr_city_phone",
      query: `${q(civicStreet)} ${q(city)} téléphone`,
      inputs: { civic, street, city },
    },
  ];

  if (owner) {
    variants.push({
      variant: "owner_addr_city",
      query: `${q(owner)} ${q(civicStreet)} ${q(city)}`,
      inputs: { owner, civic, street, city },
    });
  }

  // Dedupe by query string (after trim).
  const seen = new Set<string>();
  return variants.filter(v => {
    const key = v.query.replace(/\s+/g, " ").trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(v.query.trim());
  });
}

/** Build company/person queries used in Stage 2.
 *  Mailing-only (RC-3 fix). City and postal come from the parsed mailing address.
 */
export function buildCompanyQueries(parsed: ParsedAddress, ctx: LeadContext): BuiltQuery[] {
  const city = parsed.city;
  const postal = parsed.postal;
  const civicStreet = parsed.civicNumber && parsed.streetName ? `${parsed.civicNumber} ${parsed.streetName}` : null;

  const out: BuiltQuery[] = [];

  if (ctx.companyName) {
    const simple = simplifyCompany(ctx.companyName);
    if (city) {
      out.push({
        variant: "company_city",
        query: `${q(ctx.companyName)} ${q(city)} téléphone`,
        inputs: { company: ctx.companyName, city },
      });
    }
    if (postal) {
      out.push({
        variant: "company_postal",
        query: `${q(simple)} ${q(postal)} téléphone`,
        inputs: { company: simple, postal },
      });
    }
  }

  if (ctx.fullName) {
    if (city) {
      out.push({
        variant: "owner_city",
        query: `${q(ctx.fullName)} ${q(city)} téléphone`,
        inputs: { owner: ctx.fullName, city },
      });
    }
    if (civicStreet) {
      out.push({
        variant: "owner_addr",
        query: `${q(ctx.fullName)} ${q(civicStreet)} téléphone`,
        inputs: { owner: ctx.fullName, addr: civicStreet },
      });
    }
  }

  // Dedupe
  const seen = new Set<string>();
  return out.filter(v => {
    const key = v.query.replace(/\s+/g, " ").trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(v.query.trim());
  });
}

function simplifyCompany(name: string): string {
  return name
    .replace(/\b(INC\.?|LT[ÉE]E\.?|LTD\.?|S\.E\.N\.C\.|S\.E\.C\.|INC|LTEE|LTD|CIE|CO\.?)\b/gi, "")
    .replace(/\s+\d{4}\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
