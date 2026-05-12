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
 *
 * When ENRICHMENT_JUDGE_ENABLED=true each candidate is first persisted to
 * phone_candidates (with full provenance), then scored by a Claude Haiku judge,
 * and only approved candidates are promoted to phones. The hypothesis path is
 * still followed when the flag is false.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { routeOwner, type RoutingDecision } from "./classifier";
import { insertEvidence, insertHypothesis } from "./db";
import type { HypothesisTier, HypothesisConfidenceLabel, CanonicalOwnerRow } from "./db";
import { reverseAddressResearcher } from "./researchers/reverse-address";
import {
  namePostalDirectoryResearcher,
  type NamePostalDirectoryCandidate,
} from "./researchers/name-postal-directory";
import { crossPropertyResearcher } from "./researchers/cross-property";
import { lookupCallerName } from "../twilio/lookup";
import type { EvidenceCandidate } from "./researchers/types";
import { scoreHypothesis } from "./scorer";
import { judgePhoneCandidate } from "../llm/judge";

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
  /** When ENRICHMENT_JUDGE_ENABLED: IDs of phone_candidates rows created by the judge flow. */
  judgeCandidateIds?: string[];
}

/** Options that modify pipeline behaviour (e.g. for smoke-test / backtest runs). */
export interface PipelineBOptions {
  /** Skip all Brave-powered researchers (reverse-address, name-postal-directory). */
  skipBrave?: boolean;
  /** Skip the Twilio caller-name lookup. */
  skipTwilio?: boolean;
  /**
   * Pre-computed routing decision from the caller (e.g. pipeline.ts or the
   * backtest runner already called routeOwner before invoking runPipelineB).
   *
   * When provided, the internal routeOwner call is skipped entirely so the
   * researchers always run under the same routing context that was used to
   * select Pipeline B — even when mailing_geocode was null at routing time.
   * Without this, a lazy-geocode write that occurs inside the first routeOwner
   * call could theoretically produce a different result on the second call,
   * causing an unexpected throw from the routing guard.
   *
   * Callers MUST only pass a routing with pipeline === "B" here.
   */
  precomputedRouting?: RoutingDecision;
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
  const {
    skipBrave = false,
    skipTwilio = false,
    precomputedRouting,
    leadId,
    contactId,
    enrichmentJobId,
  } = _options;

  // Feature flag: when true, use the candidate+judge+promote flow instead of
  // writing directly to hypothesis. Default false for safety.
  const judgeEnabled =
    (process.env.ENRICHMENT_JUDGE_ENABLED ?? "").toLowerCase() === "true";

  // 1. Route check
  //
  // Use the pre-computed routing when the caller already ran routeOwner (e.g.
  // pipeline.ts or the backtest runner).  Skipping the second call prevents a
  // race where a lazy-geocode write that happened inside the first routeOwner
  // call produces a different — and potentially A-pipeline — result here,
  // which would throw and silently return UNRESOLVED for the lead.
  //
  // When precomputedRouting is absent (standalone invocations, tests) we fall
  // back to calling routeOwner as before.
  const routing: RoutingDecision =
    precomputedRouting ?? (await routeOwner(sb, ownerId));

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
        // Twilio caller-name is an API lookup — no web search, no snippet.
        snippet: null,
        searchQuery: null,
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

  const totalEvidence = allCandidates.filter((c) => c.evidenceId).length;

  // ── Judge flow (ENRICHMENT_JUDGE_ENABLED=true) ────────────────────────────
  // Each unique phone is persisted to phone_candidates with full provenance,
  // scored by the Haiku judge, and only approved candidates are promoted to
  // the phones table. The hypothesis path below is skipped when this runs.
  if (judgeEnabled && leadId && contactId) {
    const judgeCandidateIds: string[] = [];
    const ownerRow = owner as CanonicalOwnerRow;

    // Per-lead candidate cap: bounds judge cost when a single researcher
    // returns a runaway result set (e.g. a scraped CSV with hundreds of phones).
    // Rank groups so authoritative + multi-source + corroborated phones survive.
    const CANDIDATE_CAP_PER_LEAD = 25;
    const rankedGroups = [...groups.values()].sort((a, b) => {
      const aAuth = a.candidates.some((c) => c.isAuthoritative) ? 1 : 0;
      const bAuth = b.candidates.some((c) => c.isAuthoritative) ? 1 : 0;
      if (aAuth !== bAuth) return bAuth - aAuth;
      const aCorr = a.candidates.some(
        (c) => isNamePostalCandidate(c) && c.postalCorroborated,
      ) ? 1 : 0;
      const bCorr = b.candidates.some(
        (c) => isNamePostalCandidate(c) && c.postalCorroborated,
      ) ? 1 : 0;
      if (aCorr !== bCorr) return bCorr - aCorr;
      return b.candidates.length - a.candidates.length; // more sources = better
    });
    const groupsToJudge = rankedGroups.slice(0, CANDIDATE_CAP_PER_LEAD);
    if (rankedGroups.length > CANDIDATE_CAP_PER_LEAD) {
      console.warn(
        `[pipeline-b] candidate cap hit: ${rankedGroups.length} unique phones for lead ${leadId}, judging top ${CANDIDATE_CAP_PER_LEAD}`,
      );
    }

    for (const group of groupsToJudge) {
      // Use the first (or best) candidate for the group as source of provenance.
      // All candidates for the same phone share the same E.164; we pick the most
      // informative one (sourceUrl present, or first).
      const repr = group.candidates.find((c) => c.sourceUrl) ?? group.candidates[0];

      // ── 5a. Persist to phone_candidates ─────────────────────────────────
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
          initial_confidence: repr.isAuthoritative ? 80 : 50,
          candidate_status:   "candidate_found",
          review_reason:      `Pipeline B researcher: ${repr.source}`,
        })
        .select("id")
        .single();

      if (candidateError || !candidateRow) {
        console.error("[pipeline-b] phone_candidates insert failed:", candidateError?.message);
        continue;
      }

      const candidateId = (candidateRow as { id: string }).id;
      judgeCandidateIds.push(candidateId);

      // ── 5b. Judge the candidate ──────────────────────────────────────────
      const judgeResult = await judgePhoneCandidate(
        {
          phone:       repr.phone,
          sourceUrl:   repr.sourceUrl ?? null,
          snippet:     repr.snippet ?? null,
          searchQuery: repr.searchQuery ?? null,
          sourceLabel: repr.source,
        },
        {
          canonicalName: ownerRow.canonical_name,
          mailingAddress: ownerRow.mailing_address_raw ?? null,
          ownerType: ownerRow.owner_type,
        },
        { leadId, candidateId },
      );

      // ── 5c. Write verdict back to phone_candidates ───────────────────────
      // Map judge verdicts to the actual openclaw_verdict + candidate_status enums.
      //   approve  → openclaw_verdict=likely_match,   candidate_status=approved_by_anthony
      //   review   → openclaw_verdict=uncertain,      candidate_status=needs_anthony_review
      //   reject   → openclaw_verdict=unlikely_match, candidate_status=rejected_by_openclaw
      const openclawVerdict =
        judgeResult.verdict === "approve" ? "likely_match" :
        judgeResult.verdict === "review"  ? "uncertain" :
        "unlikely_match";
      const verdictStatus =
        judgeResult.verdict === "approve" ? "approved_by_anthony" :
        judgeResult.verdict === "review"  ? "needs_anthony_review" :
        "rejected_by_openclaw";

      const { error: updateError } = await sb
        .from("phone_candidates")
        .update({
          openclaw_verdict:    openclawVerdict,
          openclaw_confidence: judgeResult.confidence,
          openclaw_reasoning:  judgeResult.reasoning,
          candidate_status:    verdictStatus,
        })
        .eq("id", candidateId);
      if (updateError) {
        console.error("[pipeline-b] phone_candidates verdict update failed:", updateError.message);
      }

      // ── 5d. Promote approved candidates to phones ────────────────────────
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
            notes: `pipeline=B source=${repr.source} candidate_id=${candidateId}`,
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

  return {
    ownerId,
    evidenceCount: totalEvidence,
    hypothesisIds,
    primaryHypothesisId,
    reason: routing.reason,
  };
}
