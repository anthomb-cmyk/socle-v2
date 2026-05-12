/**
 * req-phone.ts — REQ registered-phone researcher.
 *
 * Reads the phone number stored in req_entities.registered_phone and emits
 * a single authoritative EvidenceCandidate. Also inserts an evidence row so
 * the audit trail is complete.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalOwnerRow } from "../db";
import type { ReqEntity } from "../../req/types";
import { insertEvidence } from "../db";
import { normalizePhone } from "../../twilio";
import type { EvidenceCandidate } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

/**
 * Produces evidence from the REQ registered phone field.
 *
 * @returns [] if target.registered_phone is null or un-normalisable.
 */
export async function reqPhoneResearcher(
  sb: AnyClient,
  owner: CanonicalOwnerRow,
  target: ReqEntity,
): Promise<EvidenceCandidate[]> {
  if (!target.registered_phone) return [];

  const e164 = normalizePhone(target.registered_phone);
  if (!e164) return [];

  const { data } = await insertEvidence(sb, {
    owner_id: owner.owner_id,
    source: "req_phone",
    source_url: null,
    query_text: target.neq,
    raw_response: null,
    structured: {
      phone: e164,
      neq: target.neq,
    },
    weight_at_fetch: 1.0,
  });

  return [
    {
      evidenceId: data?.evidence_id,
      source: "req_phone",
      phone: e164,
      isAuthoritative: true,
      sourceUrl: null,
      // REQ is a direct government registry lookup — no web search, no snippet.
      snippet: null,
      searchQuery: null,
    },
  ];
}
