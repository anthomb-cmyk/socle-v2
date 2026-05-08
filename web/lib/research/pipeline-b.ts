/**
 * pipeline-b.ts — Pipeline B orchestrator (individual owner research).
 *
 * Runs three Pipeline-B researchers in parallel, enriches candidate phones
 * with an optional Twilio caller-name lookup, then tiers the evidence and
 * produces hypothesis rows.
 *
 * Tier matrix (per phone group) — delegated to scoreHypothesis (scorer.ts):
 *   A — 2+ independent sources AND (≥1 postalCorroborated OR ≥1 directoryMatch)
 *   B — 1 authoritative directory source only (no postal corroboration)
 *   C — directory match only, no postal corroboration
 *   D — phone came from a director-of-other-entity connection
 *   E — single weak source (no postal, no directory, no corroboration)
 *
 * Pipeline B release rule:
 *   tier A only → status = "accepted"
 *   tier B/C/D  → status = "candidate" (review queue)
 *   tier E      → status = "rejected", status_reason = "single_weak_source"
 *
 * primaryHypothesisId is set only when a tier-A accepted hypothesis exists.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { routeOwner } from "./classifier";
import { insertEvidence, insertHypothesis } from "./db";
import type { HypothesisTier, HypothesisConfidenceLabel } from "./db";
import { reverseAddressResearcher } from "./researchers/reverse-address";
import {
  namePostalDirectoryResearcher,
  type NamePostalDirectoryCandidate,
} from "./researchers/name-postal-directory";
import { crossPropertyResearcher } from "./researchers/cross-property";
import { lookupCallerName } from "../twilio/lookup";
import type { EvidenceCandidate } from "./researchers/types";
import { scoreHypothesis } from "./scorer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface PipelineBResult {
  ownerId: string;
  evidenceCount: number;
  hypothesisIds: string[];
  primaryHypothesisId?: string;
  reason: string;
}

/** Options that modify pipeline behaviour (e.g. for smoke-test / backtest runs). */
export interface PipelineBOptions {
  /** Skip all Brave-powered researchers (reverse-address, name-postal-directory). */
  skipBrave?: boolean;
  /** Skip the Twilio caller-name lookup. */
  skipTwilio?: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PhoneGroup {
  phone: string;
  evidenceIds: string[];
  candidates: EvidenceCandidate[];
  isDirectorPhone: boolean;
}

const TIER_RANK: Record<HypothesisTier, number> = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
};

// ---------------------------------------------------------------------------
// Token-overlap helper for Twilio name matching
// ---------------------------------------------------------------------------

function hasNameOverlap(ownerName: string, callerName: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const ownerTokens = new Set(normalize(ownerName).split(" ").filter(Boolean));
  const callerTokens = normalize(callerName).split(" ").filter(Boolean);
  return callerTokens.some((t) => ownerTokens.has(t));
}

// ---------------------------------------------------------------------------
// Helper: is a candidate a NamePostalDirectoryCandidate?
// ---------------------------------------------------------------------------

function isNamePostalCandidate(
  c: EvidenceCandidate,
): c is NamePostalDirectoryCandidate {
  return (
    c.source === "name_postal_directory" &&
    "postalCorroborated" in c
  );
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run Pipeline B for the given canonical_owner.
 *
 * @throws If routeOwner returns pipeline !== 'B'.
 */
export async function runPipelineB(
  sb: AnyClient,
  ownerId: string,
  _options: PipelineBOptions = {},
): Promise<PipelineBResult> {
  const { skipBrave = false, skipTwilio = false } = _options;
  // 1. Route check
  const routing = await routeOwner(sb, ownerId);
  if (routing.pipeline !== "B") {
    throw new Error(
      `runPipelineB: owner ${ownerId} is routed to Pipeline ${routing.pipeline}, not B`,
    );
  }

  // Load the canonical_owner row for researcher context
  const { data: owner } = await sb
    .from("canonical_owner")
    .select("*")
    .eq("owner_id", ownerId)
    .single();

  if (!owner) {
    return {
      ownerId,
      evidenceCount: 0,
      hypothesisIds: [],
      reason: routing.reason,
    };
  }

  // 2. Identify "director phones" — phones from reqEnrichment.directorOf entities
  //    These are pre-classified as tier D regardless of other evidence.
  const directorPhones = new Set<string>();
  if (routing.reqEnrichment?.directorOf) {
    for (const entity of routing.reqEnrichment.directorOf) {
      if (entity.registered_phone) {
        directorPhones.add(entity.registered_phone);
      }
    }
  }

  // 3. Run researchers in parallel
  //    Brave-powered researchers (reverseAddress, namePostal) are skipped in
  //    smoke-test mode; crossProperty is always run (DB-only, no external API).
  const [reverseCandidates, namePostalCandidates, crossPropertyCandidates] =
    await Promise.all([
      skipBrave
        ? Promise.resolve([] as EvidenceCandidate[])
        : reverseAddressResearcher(sb, owner).catch((err) => {
            console.error("[pipeline-b] reverseAddressResearcher failed:", err);
            return [] as EvidenceCandidate[];
          }),
      skipBrave
        ? Promise.resolve([] as NamePostalDirectoryCandidate[])
        : namePostalDirectoryResearcher(sb, owner).catch((err) => {
            console.error("[pipeline-b] namePostalDirectoryResearcher failed:", err);
            return [] as NamePostalDirectoryCandidate[];
          }),
      crossPropertyResearcher(sb, owner).catch((err) => {
        console.error("[pipeline-b] crossPropertyResearcher failed:", err);
        return [] as EvidenceCandidate[];
      }),
    ]);

  const allCandidates: EvidenceCandidate[] = [
    ...reverseCandidates,
    ...namePostalCandidates,
    ...crossPropertyCandidates,
  ];

  // 4. Opportunistic Twilio caller-name lookup (skipped in smoke-test mode)
  const uniquePhones = [...new Set(allCandidates.map((c) => c.phone))];
  const twilioExtraCandidates: EvidenceCandidate[] = [];

  for (const phone of skipTwilio ? [] : uniquePhones) {
    const lookup = await lookupCallerName(sb, phone);
    if (lookup.error) {
      console.warn(`[pipeline-b] Twilio lookup skipped for ${phone}: ${lookup.error}`);
      continue;
    }
    if (
      lookup.caller_name &&
      hasNameOverlap(owner.canonical_name, lookup.caller_name)
    ) {
      const { data } = await insertEvidence(sb, {
        owner_id: ownerId,
        source: "twilio_caller_name",
        source_url: null,
        query_text: phone,
        raw_response: {
          caller_name: lookup.caller_name,
          caller_type: lookup.caller_type,
          line_type: lookup.line_type,
        },
        structured: {
          phone,
          caller_name: lookup.caller_name,
        },
        weight_at_fetch: 0.8,
      });

      twilioExtraCandidates.push({
        evidenceId: data?.evidence_id,
        source: "twilio_caller_name",
        phone,
        isAuthoritative: true,
        sourceUrl: null,
      });
    }
  }

  allCandidates.push(...twilioExtraCandidates);

  // 5. Group candidates by phone
  const groups = new Map<string, PhoneGroup>();

  for (const c of allCandidates) {
    if (!groups.has(c.phone)) {
      groups.set(c.phone, {
        phone: c.phone,
        evidenceIds: [],
        candidates: [],
        isDirectorPhone: directorPhones.has(c.phone),
      });
    }
    const g = groups.get(c.phone)!;
    if (c.evidenceId) g.evidenceIds.push(c.evidenceId);
    g.candidates.push(c);
  }

  // 6. Insert hypothesis rows
  const hypothesisIds: string[] = [];
  let primaryHypothesisId: string | undefined;
  let bestTierRank = -1;

  for (const group of groups.values()) {
    // Build evidence rows for the scorer, attaching extra flags from
    // NamePostalDirectoryCandidate and director-phone classification.
    const evidenceRows = group.candidates.map((c) => {
      const base = {
        source: c.source,
        sourceUrl: c.sourceUrl,
        isAuthoritative: c.isAuthoritative,
        postalCorroborated: isNamePostalCandidate(c) ? c.postalCorroborated : undefined,
        isDirectorOf: group.isDirectorPhone ? true : undefined,
      };
      // Twilio corroboration counts as postal-level corroboration
      if (c.source === "twilio_caller_name") {
        return { ...base, postalCorroborated: true };
      }
      return base;
    });

    const scored = scoreHypothesis({
      evidenceRows,
      ownerType: "individual",
      pipeline: "B",
    });

    const tier = scored.tier as HypothesisTier;
    const confidenceLabel = scored.label as HypothesisConfidenceLabel;

    let status: "accepted" | "candidate" | "rejected";
    let statusReason: string;

    if (tier === "A") {
      status = "accepted";
      statusReason = "Pipeline B tier A — auto-accepted";
    } else if (tier === "E") {
      status = "rejected";
      statusReason = "single_weak_source";
    } else {
      status = "candidate";
      statusReason = `Pipeline B tier ${tier} — review queue`;
    }

    const { data: hyp } = await insertHypothesis(sb, {
      owner_id: ownerId,
      claim_type: "phone",
      claim_value: group.phone,
      claim_value_e164: group.phone,
      tier,
      confidence_label: confidenceLabel,
      is_direct: scored.isDirect,
      status,
      status_reason: statusReason,
      evidence_ids: group.evidenceIds,
    });

    if (hyp?.hypothesis_id) {
      hypothesisIds.push(hyp.hypothesis_id);
      if (tier === "A" && TIER_RANK[tier] > bestTierRank) {
        bestTierRank = TIER_RANK[tier];
        primaryHypothesisId = hyp.hypothesis_id;
      }
    }
  }

  const totalEvidence = allCandidates.filter((c) => c.evidenceId).length;

  return {
    ownerId,
    evidenceCount: totalEvidence,
    hypothesisIds,
    primaryHypothesisId,
    reason: routing.reason,
  };
}
