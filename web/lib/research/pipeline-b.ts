/**
 * pipeline-b.ts — Pipeline B orchestrator (individual owner research).
 *
 * Runs three Pipeline-B researchers in parallel, enriches candidate phones
 * with an optional Twilio caller-name lookup, then tiers the evidence and
 * produces hypothesis rows.
 *
 * Tier matrix (per phone group):
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

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

interface PhoneGroup {
  phone: string;
  evidenceIds: string[];
  sources: EvidenceCandidate["source"][];
  postalCorroborated: boolean;
  directoryMatch: boolean;
  isDirectorPhone: boolean;
  hasAuthoritative: boolean;
}

function computeTierB(group: PhoneGroup): HypothesisTier {
  const uniqueSources = new Set(group.sources);

  // Tier D — phone came from a director-of-other-entity connection
  if (group.isDirectorPhone) return "D";

  // Tier A — 2+ independent sources AND at least one with postal corroboration
  if (uniqueSources.size >= 2 && group.postalCorroborated) {
    return "A";
  }

  // Tier B — 2+ independent sources with a directory match (no postal corroboration)
  if (uniqueSources.size >= 2 && group.directoryMatch) return "B";

  // Tier C — single directory match only (no postal corroboration, single source)
  if (group.directoryMatch) return "C";

  // Tier E — single weak source, no postal, no directory
  return "E";
}

function tierToLabel(tier: HypothesisTier): HypothesisConfidenceLabel {
  if (tier === "A") return "confirmed";
  if (tier === "B") return "likely";
  if (tier === "C" || tier === "D") return "connected";
  return "weak";
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
): Promise<PipelineBResult> {
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
  const [reverseCandidates, namePostalCandidates, crossPropertyCandidates] =
    await Promise.all([
      reverseAddressResearcher(sb, owner).catch((err) => {
        console.error("[pipeline-b] reverseAddressResearcher failed:", err);
        return [] as EvidenceCandidate[];
      }),
      namePostalDirectoryResearcher(sb, owner).catch((err) => {
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

  // 4. Opportunistic Twilio caller-name lookup
  const uniquePhones = [...new Set(allCandidates.map((c) => c.phone))];
  const twilioExtraCandidates: EvidenceCandidate[] = [];

  for (const phone of uniquePhones) {
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
        sources: [],
        postalCorroborated: false,
        directoryMatch: false,
        isDirectorPhone: directorPhones.has(c.phone),
        hasAuthoritative: false,
      });
    }
    const g = groups.get(c.phone)!;
    if (c.evidenceId) g.evidenceIds.push(c.evidenceId);
    g.sources.push(c.source);
    if (c.isAuthoritative) g.hasAuthoritative = true;

    // Propagate postal corroboration and directory match flags
    if (isNamePostalCandidate(c)) {
      if (c.postalCorroborated) g.postalCorroborated = true;
      if (c.directoryMatch) g.directoryMatch = true;
    }

    // Twilio corroboration also counts as postal-level corroboration
    if (c.source === "twilio_caller_name") {
      g.postalCorroborated = true;
    }
  }

  // 6. Insert hypothesis rows
  const hypothesisIds: string[] = [];
  let primaryHypothesisId: string | undefined;
  let bestTierRank = -1;

  for (const group of groups.values()) {
    const tier = computeTierB(group);
    const confidenceLabel = tierToLabel(tier);

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
      is_direct: tier === "A" || tier === "B",
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
