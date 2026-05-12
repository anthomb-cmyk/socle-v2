/**
 * cross-property.ts — Cross-property researcher for Pipeline B.
 *
 * Finds phone numbers for an owner by looking up:
 *  1. Other canonical_owner rows with the same canonical_name_normalized (or
 *     matching owner_alias) that have published owner_record rows with a
 *     primary_phone_e164.
 *  2. The legacy CRM phones table, joined via contacts.full_name match.
 *
 * Each match becomes a non-authoritative EvidenceCandidate with
 * source: "cross_property".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalOwnerRow } from "../db";
import { insertEvidence } from "../db";
import type { EvidenceCandidate } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export type CrossPropertyCandidate = EvidenceCandidate & {
  source: "cross_property";
};

/**
 * Research phones for an owner via cross-property and CRM lookups.
 *
 * All DB failures are caught and logged — returns partial results or [] on error.
 */
export async function crossPropertyResearcher(
  sb: AnyClient,
  owner: CanonicalOwnerRow,
): Promise<CrossPropertyCandidate[]> {
  const candidates: CrossPropertyCandidate[] = [];
  const seenPhones = new Set<string>();

  // -------------------------------------------------------------------------
  // 1. canonical_owner → owner_record cross-reference
  //    Find other canonical_owners with same canonical_name_normalized whose
  //    published owner_record has a primary_phone_e164.
  // -------------------------------------------------------------------------
  try {
    // Find sibling owner IDs via canonical_name_normalized match
    const { data: siblings } = await sb
      .from("canonical_owner")
      .select("owner_id")
      .eq("canonical_name_normalized", owner.canonical_name_normalized)
      .neq("owner_id", owner.owner_id);

    // Also check owner_alias for alias hits
    const { data: aliasSiblings } = await sb
      .from("owner_alias")
      .select("owner_id")
      .eq("alias_normalized", owner.canonical_name_normalized)
      .neq("owner_id", owner.owner_id);

    const siblingIds = [
      ...(siblings ?? []).map((r: { owner_id: string }) => r.owner_id),
      ...(aliasSiblings ?? []).map((r: { owner_id: string }) => r.owner_id),
    ];
    const uniqueSiblingIds = [...new Set(siblingIds)];

    if (uniqueSiblingIds.length > 0) {
      const { data: records } = await sb
        .from("owner_record")
        .select("owner_id, primary_phone_e164")
        .in("owner_id", uniqueSiblingIds)
        .not("primary_phone_e164", "is", null);

      for (const rec of records ?? []) {
        const phone = rec.primary_phone_e164 as string;
        if (!phone || seenPhones.has(phone)) continue;
        seenPhones.add(phone);

        const { data } = await insertEvidence(sb, {
          owner_id: owner.owner_id,
          source: "cross_property",
          source_url: null,
          query_text: `canonical_name_normalized=${owner.canonical_name_normalized}`,
          raw_response: null,
          structured: {
            phone,
            sibling_owner_id: rec.owner_id,
            method: "canonical_name_match",
          },
          weight_at_fetch: 0.5,
        });

        candidates.push({
          evidenceId: data?.evidence_id,
          source: "cross_property",
          phone,
          isAuthoritative: false,
          sourceUrl: null,
          // cross_property is a DB-only lookup — no web search, no snippet.
          snippet: null,
          searchQuery: null,
        });
      }
    }
  } catch (err) {
    console.error("[cross-property] canonical_owner lookup failed:", err);
  }

  // -------------------------------------------------------------------------
  // 2. Legacy CRM: phones → contacts → name match
  //    Join contacts on full_name ILIKE the owner's canonical_name, then
  //    return any associated phone rows.
  // -------------------------------------------------------------------------
  try {
    // Find contacts whose full_name matches the owner canonical_name
    const { data: matchingContacts } = await sb
      .from("contacts")
      .select("id")
      .ilike("full_name", owner.canonical_name);

    const contactIds = (matchingContacts ?? []).map(
      (c: { id: string }) => c.id,
    );

    if (contactIds.length > 0) {
      const { data: phoneRows } = await sb
        .from("phones")
        .select("e164, contact_id")
        .in("contact_id", contactIds)
        .not("e164", "is", null);

      for (const row of phoneRows ?? []) {
        const phone = row.e164 as string;
        if (!phone || seenPhones.has(phone)) continue;
        seenPhones.add(phone);

        const { data } = await insertEvidence(sb, {
          owner_id: owner.owner_id,
          source: "cross_property",
          source_url: null,
          query_text: `contacts.full_name ILIKE '${owner.canonical_name}'`,
          raw_response: null,
          structured: {
            phone,
            contact_id: row.contact_id,
            method: "crm_name_match",
          },
          weight_at_fetch: 0.5,
        });

        candidates.push({
          evidenceId: data?.evidence_id,
          source: "cross_property",
          phone,
          isAuthoritative: false,
          sourceUrl: null,
          // cross_property CRM lookup is DB-only — no web search, no snippet.
          snippet: null,
          searchQuery: null,
        });
      }
    }
  } catch (err) {
    console.error("[cross-property] CRM lookup failed:", err);
  }

  return candidates;
}
