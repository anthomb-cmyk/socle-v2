/**
 * pipeline-a.ts — Pipeline A orchestrator (business entity research).
 *
 * Runs the three Phase-5 researchers in order, enriches each candidate phone
 * with a Twilio caller-name lookup, then tiers the evidence and produces
 * hypothesis rows.
 *
 * Tier matrix (per phone group) — delegated to scoreHypothesis (scorer.ts):
 *   A — 2+ sources, ≥1 authoritative → "confirmed"
 *   B — 1 authoritative source       → "likely"
 *   C — directory-only (no auth)     → "connected"
 *   E — single weak source           → "weak"
 *
 * Pipeline A releases (status = "accepted") at tier A or B.
 * Tier C/E leaves hypotheses as "candidate" for human review.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { routeOwner } from "./classifier";
import { insertEvidence, insertHypothesis } from "./db";
import type { HypothesisTier, HypothesisConfidenceLabel } from "./db";
import { reqPhoneResearcher } from "./researchers/req-phone";
import { companyWebsiteResearcher } from "./researchers/company-website";
import { pagesJaunesBusinessResearcher } from "./researchers/pages-jaunes-business";
import { lookupCallerName } from "../twilio/lookup";
import type { EvidenceCandidate } from "./researchers/types";
import { scoreHypothesis } from "./scorer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineAResult {
  ownerId: string;
  evidenceCount: number;
  hypothesisIds: string[];
  primaryHypothesisId?: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PhoneGroup {
  phone: string;
  evidenceIds: string[];
  candidates: EvidenceCandidate[];
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

function hasNameOverlap(entityName: string, callerName: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const entityTokens = new Set(normalize(entityName).split(" ").filter(Boolean));
  const callerTokens = normalize(callerName).split(" ").filter(Boolean);
  return callerTokens.some((t) => entityTokens.has(t));
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run Pipeline A for the given canonical_owner.
 *
 * @throws If routeOwner returns pipeline !== 'A'.
 */
export async function runPipelineA(
  sb: AnyClient,
  ownerId: string,
): Promise<PipelineAResult> {
  // 1. Route check
  const routing = await routeOwner(sb, ownerId);
  if (routing.pipeline !== "A") {
    throw new Error(
      `runPipelineA: owner ${ownerId} is routed to Pipeline ${routing.pipeline}, not A`,
    );
  }

  const { primaryTarget } = routing;

  // 2. Collect evidence candidates
  const allCandidates: EvidenceCandidate[] = [];

  if (primaryTarget) {
    // We load the owner row once so we can pass it to researchers
    const { data: owner } = await sb
      .from("canonical_owner")
      .select("*")
      .eq("owner_id", ownerId)
      .single();

    if (owner) {
      // 2a. REQ phone
      try {
        const reqCandidates = await reqPhoneResearcher(sb, owner, primaryTarget);
        allCandidates.push(...reqCandidates);
      } catch (err) {
        console.error("[pipeline-a] reqPhoneResearcher failed:", err);
      }

      // 2b. Company website
      try {
        const webCandidates = await companyWebsiteResearcher(sb, owner, primaryTarget);
        allCandidates.push(...webCandidates);
      } catch (err) {
        console.error("[pipeline-a] companyWebsiteResearcher failed:", err);
      }

      // 2c. Pages Jaunes
      try {
        const pjCandidates = await pagesJaunesBusinessResearcher(sb, owner, primaryTarget);
        allCandidates.push(...pjCandidates);
      } catch (err) {
        console.error("[pipeline-a] pagesJaunesBusinessResearcher failed:", err);
      }
    }
  }

  // 3. Twilio caller-name enrichment
  const uniquePhones = [...new Set(allCandidates.map((c) => c.phone))];
  const twilioExtraCandidates: EvidenceCandidate[] = [];

  for (const phone of uniquePhones) {
    const lookup = await lookupCallerName(sb, phone);
    if (lookup.error) {
      console.warn(`[pipeline-a] Twilio lookup skipped for ${phone}: ${lookup.error}`);
      continue;
    }
    if (
      lookup.caller_name &&
      primaryTarget &&
      hasNameOverlap(primaryTarget.legal_name, lookup.caller_name)
    ) {
      // Insert a twilio_caller_name evidence row
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

  // 4. Group candidates by phone
  const groups = new Map<string, PhoneGroup>();
  for (const c of allCandidates) {
    if (!groups.has(c.phone)) {
      groups.set(c.phone, {
        phone: c.phone,
        evidenceIds: [],
        candidates: [],
      });
    }
    const g = groups.get(c.phone)!;
    if (c.evidenceId) g.evidenceIds.push(c.evidenceId);
    g.candidates.push(c);
  }

  // 5. Insert hypothesis rows
  const hypothesisIds: string[] = [];
  let primaryHypothesisId: string | undefined;
  let bestTierRank = -1;

  for (const group of groups.values()) {
    const scored = scoreHypothesis({
      evidenceRows: group.candidates.map((c) => ({
        source: c.source,
        sourceUrl: c.sourceUrl,
        isAuthoritative: c.isAuthoritative,
      })),
      ownerType: "named_co",
      pipeline: "A",
    });

    const tier = scored.tier as HypothesisTier;
    const confidenceLabel = scored.label as HypothesisConfidenceLabel;
    const shouldAccept = tier === "A" || tier === "B";

    const { data: hyp } = await insertHypothesis(sb, {
      owner_id: ownerId,
      claim_type: "phone",
      claim_value: group.phone,
      claim_value_e164: group.phone,
      tier,
      confidence_label: confidenceLabel,
      is_direct: scored.isDirect,
      status: shouldAccept ? "accepted" : "candidate",
      status_reason: shouldAccept
        ? `Pipeline A tier ${tier} — auto-accepted`
        : `Pipeline A tier ${tier} — review queue`,
      evidence_ids: group.evidenceIds,
    });

    if (hyp?.hypothesis_id) {
      hypothesisIds.push(hyp.hypothesis_id);
      if (TIER_RANK[tier] > bestTierRank) {
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
