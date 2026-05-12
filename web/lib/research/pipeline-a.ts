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
 *
 * When ENRICHMENT_JUDGE_ENABLED=true each candidate is first persisted to
 * phone_candidates (with full provenance), then scored by a Claude Haiku judge,
 * and only approved candidates are promoted to phones. The hypothesis path is
 * still followed when the flag is false.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { routeOwner } from "./classifier";
import { insertEvidence, insertHypothesis } from "./db";
import type { HypothesisTier, HypothesisConfidenceLabel, CanonicalOwnerRow } from "./db";
import { reqPhoneResearcher } from "./researchers/req-phone";
import { companyWebsiteResearcher } from "./researchers/company-website";
import { pagesJaunesBusinessResearcher } from "./researchers/pages-jaunes-business";
import { lookupCallerName } from "../twilio/lookup";
import type { EvidenceCandidate } from "./researchers/types";
import { scoreHypothesis } from "./scorer";
import { judgePhoneCandidate } from "../llm/judge";

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
  /** When ENRICHMENT_JUDGE_ENABLED: IDs of phone_candidates rows created by the judge flow. */
  judgeCandidateIds?: string[];
}

/** Options that modify pipeline behaviour (e.g. for smoke-test / backtest runs). */
export interface PipelineAOptions {
  /** Skip all Brave-powered researchers (company-website, pages-jaunes-business). */
  skipBrave?: boolean;
  /** Skip the Twilio caller-name lookup. */
  skipTwilio?: boolean;
  /**
   * CRM lead ID — required when ENRICHMENT_JUDGE_ENABLED=true so phone_candidates
   * rows can reference the lead.
   */
  leadId?: string;
  /**
   * CRM contact ID — required when ENRICHMENT_JUDGE_ENABLED=true so phone_candidates
   * rows can reference the contact.
   */
  contactId?: string;
  /**
   * Enrichment job ID from enrichment_jobs — required when ENRICHMENT_JUDGE_ENABLED=true
   * so phone_candidates rows have a complete audit trail.
   */
  enrichmentJobId?: string;
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
  _options: PipelineAOptions = {},
): Promise<PipelineAResult> {
  const {
    skipBrave = false,
    skipTwilio = false,
    leadId,
    contactId,
    enrichmentJobId,
  } = _options;

  // Feature flag: when true, use the candidate+judge+promote flow instead of
  // writing directly to hypothesis. Default false for safety.
  const judgeEnabled =
    (process.env.ENRICHMENT_JUDGE_ENABLED ?? "").toLowerCase() === "true";

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

      // 2b. Company website (Brave-powered — skipped in smoke-test mode)
      if (!skipBrave) {
        try {
          const webCandidates = await companyWebsiteResearcher(sb, owner, primaryTarget);
          allCandidates.push(...webCandidates);
        } catch (err) {
          console.error("[pipeline-a] companyWebsiteResearcher failed:", err);
        }
      }

      // 2c. Pages Jaunes (Brave-powered — skipped in smoke-test mode)
      if (!skipBrave) {
        try {
          const pjCandidates = await pagesJaunesBusinessResearcher(sb, owner, primaryTarget);
          allCandidates.push(...pjCandidates);
        } catch (err) {
          console.error("[pipeline-a] pagesJaunesBusinessResearcher failed:", err);
        }
      }
    }
  }

  // 3. Twilio caller-name enrichment (skipped in smoke-test mode)
  const uniquePhones = [...new Set(allCandidates.map((c) => c.phone))];
  const twilioExtraCandidates: EvidenceCandidate[] = [];

  for (const phone of skipTwilio ? [] : uniquePhones) {
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

  const totalEvidence = allCandidates.filter((c) => c.evidenceId).length;

  // ── Judge flow (ENRICHMENT_JUDGE_ENABLED=true) ────────────────────────────
  // Each unique phone is persisted to phone_candidates with full provenance,
  // scored by the Haiku judge, and only approved candidates are promoted to
  // the phones table. The hypothesis path below is skipped when this runs.
  if (judgeEnabled && leadId && contactId) {
    const judgeCandidateIds: string[] = [];

    // Load the canonical_owner row for judge context (may already be in scope
    // if primaryTarget was loaded, but owner type / mailing address come from
    // canonical_owner directly).
    const { data: ownerForJudge } = await sb
      .from("canonical_owner")
      .select("canonical_name, owner_type, mailing_address_raw")
      .eq("owner_id", ownerId)
      .single();

    const ownerContext = ownerForJudge as Pick<CanonicalOwnerRow, "canonical_name" | "owner_type" | "mailing_address_raw"> | null;

    for (const group of groups.values()) {
      // Use the first (or best) candidate as provenance representative.
      const repr = group.candidates.find((c) => c.sourceUrl) ?? group.candidates[0];

      // ── 4a. Persist to phone_candidates ───────────────────────────────────
      const { data: candidateRow, error: candidateError } = await sb
        .from("phone_candidates")
        .insert({
          lead_id:            leadId,
          contact_id:         contactId,
          enrichment_job_id:  enrichmentJobId ?? null,
          phone_raw:          repr.phone,
          phone_e164:         repr.phone,
          stage:              "company_search",   // closest legacy stage label for research pipeline
          source_label:       repr.source,
          source_url:         repr.sourceUrl ?? null,
          snippet:            repr.snippet ?? null,
          search_query:       repr.searchQuery ?? null,
          initial_confidence: repr.isAuthoritative ? 90 : 55,
          candidate_status:   "candidate_found",
          review_reason:      `Pipeline A researcher: ${repr.source}`,
        })
        .select("id")
        .single();

      if (candidateError || !candidateRow) {
        console.error("[pipeline-a] phone_candidates insert failed:", candidateError?.message);
        continue;
      }

      const candidateId = (candidateRow as { id: string }).id;
      judgeCandidateIds.push(candidateId);

      // ── 4b. Judge the candidate ────────────────────────────────────────────
      const judgeResult = await judgePhoneCandidate(
        {
          phone:       repr.phone,
          sourceUrl:   repr.sourceUrl ?? null,
          snippet:     repr.snippet ?? null,
          searchQuery: repr.searchQuery ?? null,
          sourceLabel: repr.source,
        },
        {
          canonicalName:  ownerContext?.canonical_name ?? primaryTarget?.legal_name ?? ownerId,
          mailingAddress: ownerContext?.mailing_address_raw ?? null,
          ownerType:      ownerContext?.owner_type ?? "named_co",
        },
        { leadId, candidateId },
      );

      // ── 4c. Write verdict back to phone_candidates ─────────────────────────
      // Map judge verdicts to existing candidate_status enum values:
      //   approve  → approved_by_anthony  (judge acts as automated approver)
      //   review   → needs_anthony_review (route to human review queue)
      //   reject   → rejected_by_openclaw (LLM judge rejection, columns named for openclaw)
      const verdictStatus =
        judgeResult.verdict === "approve" ? "approved_by_anthony" :
        judgeResult.verdict === "review"  ? "needs_anthony_review" :
        "rejected_by_openclaw";

      await sb
        .from("phone_candidates")
        .update({
          openclaw_verdict:    judgeResult.verdict,
          openclaw_confidence: judgeResult.confidence,
          openclaw_reasoning:  judgeResult.reasoning,
          candidate_status:    verdictStatus,
        })
        .eq("id", candidateId);

      // ── 4d. Promote approved candidates to phones ──────────────────────────
      if (judgeResult.verdict === "approve") {
        await sb.from("phones").upsert(
          {
            contact_id: contactId,
            e164:       repr.phone,
            source:     "enrichment_other",
            confidence: judgeResult.confidence,
            evidence:   JSON.stringify({
              judge_reasoning: judgeResult.reasoning,
              source_url:      repr.sourceUrl ?? null,
              snippet:         repr.snippet ?? null,
              search_query:    repr.searchQuery ?? null,
              candidate_id:    candidateId,
            }),
            notes: `pipeline=A source=${repr.source} candidate_id=${candidateId}`,
          },
          { onConflict: "contact_id,e164", ignoreDuplicates: false },
        );
      }
    }

    return {
      ownerId,
      evidenceCount: totalEvidence,
      hypothesisIds: [],
      reason: routing.reason,
      judgeCandidateIds,
    };
  }

  // ── Legacy hypothesis flow (ENRICHMENT_JUDGE_ENABLED=false or missing context) ──
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

  return {
    ownerId,
    evidenceCount: totalEvidence,
    hypothesisIds,
    primaryHypothesisId,
    reason: routing.reason,
  };
}
