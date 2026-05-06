// One-time backfill: re-run the v3 import validator over every existing
// contact's mailing_address + name, populating the new structured columns
// and parse-quality fields.
//
// Strategy
//   - Read every contact whose mailing_parsed_at IS NULL.
//   - Run parseQuebecAddress on contact.mailing_address.
//   - Cross-check parsed city against contact.mailing_city; mark
//     incoherent_city if they disagree.
//   - For person contacts, run the inversion-aware name-parser on
//     (first_name, last_name) and update if needed.
//   - Write the new columns. Never touch human-entered fields when nothing
//     changed.
//
// Returns a summary with counts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseQuebecAddress, foldText, levenshtein } from "@/lib/enrichment/address-parser";
import { parseNameFromFields, parseFullNameOnly } from "./name-parser";
import type { ContactParseQuality } from "./types";

export interface ReparseOptions {
  /** Hard limit (for staged rollout). */
  limit?: number;
  /** Only re-parse contacts whose lead has not yet been enriched. */
  unenrichedOnly?: boolean;
  /** Dry run — compute changes but don't write. */
  dryRun?: boolean;
}

export interface ReparseSummary {
  scanned: number;
  updated: number;
  byMailingQuality: Record<string, number>;
  byNameQuality: Record<string, number>;
  inversionsCorrected: number;
  middleNamesMoved: number;
}

export async function reparseAllContacts(
  sb: SupabaseClient,
  opts: ReparseOptions = {},
): Promise<ReparseSummary> {
  const limit = opts.limit ?? 1000;
  const out: ReparseSummary = {
    scanned: 0, updated: 0,
    byMailingQuality: {},
    byNameQuality: {},
    inversionsCorrected: 0,
    middleNamesMoved: 0,
  };

  type Row = {
    id: string;
    kind: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
    mailing_parsed_at: string | null;
  };

  // (unenrichedOnly handling is left as a follow-up — requires a join on leads.)
  const { data, error } = await sb.from("contacts")
    .select("id, kind, full_name, first_name, last_name, company_name, mailing_address, mailing_city, mailing_postal, mailing_parsed_at")
    .is("mailing_parsed_at", null)
    .limit(limit);
  if (error || !data) return out;

  for (const r of data as Row[]) {
    out.scanned++;

    let mailQuality: ContactParseQuality = "unparseable";
    const update: Record<string, unknown> = {};

    if (r.mailing_address) {
      const parsed = parseQuebecAddress(r.mailing_address);
      update.mailing_civic       = parsed.civicNumber;
      update.mailing_street      = parsed.streetName;
      update.mailing_unit        = parsed.unit;
      update.mailing_province    = parsed.province;
      update.mailing_postal_fsa  = parsed.postalFsa;
      if (parsed.postal) update.mailing_postal = parsed.postal;

      if (parsed.civicNumber && parsed.streetName && parsed.city && parsed.postal) {
        mailQuality = "complete";
      } else if (!parsed.civicNumber) mailQuality = "missing_civic";
      else if (!parsed.streetName)    mailQuality = "missing_street";
      else if (!parsed.postal)        mailQuality = "missing_postal";
      else                             mailQuality = "unparseable";

      // City coherence
      if (parsed.city && r.mailing_city) {
        const a = foldText(parsed.city);
        const b = foldText(r.mailing_city);
        if (a !== b && levenshtein(a, b) > 2) mailQuality = "incoherent_city";
      }
      if (!r.mailing_city && parsed.city) update.mailing_city = parsed.city;
    }

    update.mailing_parse_quality = mailQuality;
    update.mailing_parsed_at     = new Date().toISOString();
    out.byMailingQuality[mailQuality] = (out.byMailingQuality[mailQuality] ?? 0) + 1;

    // Name re-parse for persons.
    if (r.kind === "person") {
      const result = (r.first_name || r.last_name)
        ? parseNameFromFields({ fullName: r.full_name, prenomField: r.first_name, nomField: r.last_name })
        : parseFullNameOnly(r.full_name);

      if (result.parseQuality !== "single_token" && result.parseQuality !== "unparseable") {
        update.first_name = result.firstName;
        update.last_name = result.lastName;
        update.full_name = result.fullName;
        update.middle_names = result.middleNames;
        update.name_was_inverted = result.wasInverted;
        if (result.wasInverted) out.inversionsCorrected++;
        if (result.parseQuality === "middle_moved") out.middleNamesMoved++;
      }
      update.name_parse_quality = result.parseQuality;
      out.byNameQuality[result.parseQuality] = (out.byNameQuality[result.parseQuality] ?? 0) + 1;
    } else {
      update.name_parse_quality = "company";
      out.byNameQuality["company"] = (out.byNameQuality["company"] ?? 0) + 1;
    }

    if (!opts.dryRun) {
      const { error: updErr } = await sb.from("contacts").update(update).eq("id", r.id);
      if (!updErr) out.updated++;
    }
  }

  return out;
}
