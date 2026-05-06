// Layer A — Pre-flight lead validator (v3 enrichment redesign).
//
// Purpose
//   Decide whether a lead's mailing address is usable for phone enrichment.
//   Anything that fails pre-flight is marked unsuitable_for_phone_enrichment
//   and never reaches Brave / OpenClaw / Haiku. This eliminates RC-1, RC-2,
//   and RC-3 from the audit.
//
// Hard contract
//   - Mailing address ONLY. Property address is never used as a fallback.
//   - Required fields after parsing: civic number, street name, city, postal.
//   - mailing_city must be coherent with the parsed city (Levenshtein ≤ 2 after
//     accent-folding) — otherwise the input row is internally contradictory.

import type { LeadContext, PreflightResult } from "./types";
import { parseQuebecAddress, foldText, levenshtein, isAddressSearchable } from "./address-parser";

export function runPreflight(ctx: LeadContext): PreflightResult {
  const failures: string[] = [];

  if (!ctx.mailingAddress || !ctx.mailingAddress.trim()) {
    failures.push("mailing_address_missing");
    return { ok: false, parsed: null, cityMatch: null, failures };
  }

  const parsed = parseQuebecAddress(ctx.mailingAddress);

  // Accept either a single civicNumber ("3720") or a civicRange ("200-298").
  // Quebec rôle uses ranges for multi-unit buildings — they ARE valid civics.
  if (!parsed.civicNumber && !parsed.civicRange) failures.push("missing_civic_number");
  if (!parsed.streetName)  failures.push("missing_street_name");
  if (!parsed.city)        failures.push("missing_city");
  if (!parsed.postal)      failures.push("missing_postal_code");

  // City-coherence: compare the parsed city to the lead's mailing_city field.
  let cityMatch: PreflightResult["cityMatch"] = null;
  if (parsed.city && ctx.mailingCity) {
    const a = foldText(parsed.city);
    const b = foldText(ctx.mailingCity);
    if (a === b) {
      cityMatch = "match";
    } else if (levenshtein(a, b) <= 2) {
      cityMatch = "match";
    } else {
      cityMatch = "mismatch";
      failures.push(`city_mismatch:parsed=${parsed.city}|field=${ctx.mailingCity}`);
    }
  } else if (!ctx.mailingCity && parsed.city) {
    cityMatch = "missing";
    // Not a hard failure — parsed.city is enough.
  }

  // Belt-and-suspenders: the parsed result must be usable.
  if (!isAddressSearchable(parsed) && failures.length === 0) {
    failures.push("address_not_searchable");
  }

  return {
    ok: failures.length === 0,
    parsed,
    cityMatch,
    failures,
  };
}
