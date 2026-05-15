// Address-first phone enrichment pipeline (v3 redesign).
//
// Stage order:
//   0. Existing-phone gate     — skip if any phone already exists
//   A. Pre-flight              — parse mailing address; reject if incomplete
//   1. Address search          — Brave queries built from parsed mailing address
//   2. Company/person search   — only if Stage 1 produced no reviewable candidate
//   2.5 Query rewriter         — LLM-suggested alternate queries (no-op if no API key)
//   3. OpenClaw fallback       — async deep search (n8n)
//
// Disposition semantics (per candidate):
//   auto_attached         — score ≥ 85 + authoritative source + owner-name hit;
//                           lead → ready_to_call
//   needs_anthony_review  — gates pass + score ≥ 70; saved to /phone-review
//   weak_review           — gates pass + 50 ≤ score < 70; saved but collapsed in UI
//   quarantined           — gate failure; saved for audit but never shown by default
//   pipeline_rejected     — phone-shape rejection (NEQ/fax/etc.); audit only

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LeadContext,
  PipelineStage,
  EnrichmentEventType,
  ParsedAddress,
  PhoneCandidate,
  GateReport,
  SourceClassification,
} from "./types";
import { runAddressSearch, runCompanySearch, runQueries, type EvaluatedStageResult } from "./brave-search";
import type { BuiltQuery } from "./query-builder";
import { requestOpenclawDeepSearch } from "./openclaw-validate";
import { runPreflight } from "./preflight";
import { suggestAlternateQueries } from "@/lib/llm/query-rewriter";
import { enqueue } from "@/lib/queue/enqueue";
import { tryExistingPhoneShortCircuit, tryCrossContactPortfolioMatch } from "./portfolio-shortcircuit";

// ── Logging ──────────────────────────────────────────────────────────────────

async function logEvent(
  sb: SupabaseClient,
  leadId: string,
  eventType: EnrichmentEventType,
  stage: PipelineStage | null,
  payload: Record<string, unknown>,
  candidateId?: string,
) {
  await sb.from("enrichment_events").insert({
    lead_id:      leadId,
    event_type:   eventType,
    stage:        stage ?? null,
    candidate_id: candidateId ?? null,
    payload,
  });
}

async function setLeadStatus(sb: SupabaseClient, leadId: string, status: string) {
  await sb.from("leads").update({ status }).eq("id", leadId);
  await sb.from("enrichment_events").insert({
    lead_id:    leadId,
    event_type: "lead_status_updated",
    stage:      null,
    payload:    { new_status: status },
  });
}

// ── Persisting candidates with gate reports ─────────────────────────────────

type EvaluatedCandidate = PhoneCandidate & { report: GateReport; classification: SourceClassification };

async function persistCandidate(
  sb: SupabaseClient,
  ctx: LeadContext,
  c: EvaluatedCandidate,
): Promise<string> {
  const dispositionToStatus: Record<GateReport["disposition"], string> = {
    auto_attached:         "auto_attached",
    needs_anthony_review:  "needs_anthony_review",
    weak_review:           "weak_review",
    quarantined:           "quarantined",
    pipeline_rejected:     "pipeline_rejected",
  };

  const gateReportShort = c.report.outcomes.map(o => `${o.gate}=${o.pass ? "pass" : "fail"}`).join(", ");
  const reviewReason =
    c.report.disposition === "auto_attached"
      ? `Auto-attached: score ${c.report.score} via ${c.classification.sourceClass}`
      : c.report.disposition === "needs_anthony_review"
        ? `Needs review: score ${c.report.score}; gates ${gateReportShort}`
        : c.report.disposition === "weak_review"
          ? `Weak: score ${c.report.score}; gates ${gateReportShort}`
          : c.report.disposition === "quarantined"
            ? `Quarantined: ${c.report.firstFailure} failed`
            : `Pipeline-rejected: ${c.report.outcomes[0]?.reason ?? "extraction rejected"}`;

  const { data, error } = await sb.from("phone_candidates").insert({
    lead_id:             ctx.leadId,
    contact_id:          ctx.contactId,
    enrichment_job_id:   ctx.enrichmentJobId,
    phone_raw:           c.phoneRaw,
    phone_e164:          c.phoneE164,
    stage:               c.stage,
    source_label:        c.sourceLabel,
    source_url:          c.sourceUrl,
    snippet:             c.snippet,
    initial_confidence:  c.initialConfidence,
    candidate_status:    dispositionToStatus[c.report.disposition],
    matched_on:          c.matchedOn,
    search_query:        c.searchQuery,
    candidate_name:      c.candidateName,
    candidate_address:   c.candidateAddress,
    related_entity_name: c.relatedEntityName,
    related_entity_type: c.relatedEntityType,
    review_reason:       reviewReason,
    // v3 fields
    gate_results:        c.report,
    source_class:        c.classification.sourceClass,
  }).select("id").single();
  if (error || !data) throw new Error(`phone_candidates insert: ${error?.message}`);
  const candidateId = (data as { id: string }).id;

  // Per-disposition events
  await logEvent(sb, ctx.leadId, "phone_candidate_found", c.stage, {
    phone_e164: c.phoneE164,
    confidence: c.initialConfidence,
    matched_on: c.matchedOn,
    source_class: c.classification.sourceClass,
    disposition: c.report.disposition,
  }, candidateId);

  if (c.report.disposition === "auto_attached") {
    await logEvent(sb, ctx.leadId, "phone_auto_attached", c.stage, {
      candidate_id: candidateId, score: c.report.score,
    }, candidateId);
  } else if (c.report.disposition === "needs_anthony_review" || c.report.disposition === "weak_review") {
    await logEvent(sb, ctx.leadId, "phone_candidate_needs_review", c.stage, {
      candidate_id: candidateId, score: c.report.score, gate_summary: gateReportShort,
    }, candidateId);
  } else if (c.report.disposition === "quarantined") {
    await logEvent(sb, ctx.leadId, "candidate_quarantined", c.stage, {
      candidate_id: candidateId, gate: c.report.firstFailure, reason: c.report.outcomes.find(o => !o.pass)?.reason,
    }, candidateId);
  } else if (c.report.disposition === "pipeline_rejected") {
    await logEvent(sb, ctx.leadId, "candidate_pipeline_rejected", c.stage, {
      candidate_id: candidateId, reason: c.report.outcomes[0]?.reason,
    }, candidateId);
  }

  return candidateId;
}

async function autoAttachPhone(sb: SupabaseClient, ctx: LeadContext, c: EvaluatedCandidate, candidateId: string) {
  await sb.from("phones").upsert({
    contact_id:  ctx.contactId,
    e164:        c.phoneE164 ?? c.phoneRaw,
    display:     c.phoneRaw,
    status:      "unverified",
    source:      "enrichment_other",
    confidence:  c.initialConfidence,
    evidence:    c.snippet ?? `auto-attached from ${c.sourceLabel} (${c.matchedOn})`,
    notes:       `stage=${c.stage} matched_on=${c.matchedOn} candidate=${candidateId} score=${c.report.score}`,
  }, { onConflict: "contact_id,e164", ignoreDuplicates: true });
  await setLeadStatus(sb, ctx.leadId, "ready_to_call");

  // Enqueue briefing + fit-score via durable queue (replaces fire-and-forget).
  await enqueue(sb, ctx.leadId, "briefing", 3);
  await enqueue(sb, ctx.leadId, "fit_score", 3);
}

// ── Routing decision per stage ──────────────────────────────────────────────

type StageOutcome = "solved" | "review" | "continue";

async function routeStageResult(
  sb: SupabaseClient,
  ctx: LeadContext,
  stageResult: EvaluatedStageResult,
): Promise<{ outcome: StageOutcome; candidateIds: string[] }> {
  const candidateIds: string[] = [];
  if (stageResult.candidates.length === 0) return { outcome: "continue", candidateIds };

  // Persist EVERY evaluated candidate (auto, review, weak, quarantine, rejected)
  // — visibility into every decision is part of the redesign.
  let auto: EvaluatedCandidate | null = null;
  for (const c of stageResult.candidates) {
    const id = await persistCandidate(sb, ctx, c);
    candidateIds.push(id);
    if (c.report.disposition === "auto_attached" && !auto) {
      auto = c;
      await autoAttachPhone(sb, ctx, c, id);
    }
  }

  if (auto) return { outcome: "solved", candidateIds };

  const hasReviewable = stageResult.candidates.some(c =>
    c.report.disposition === "needs_anthony_review" || c.report.disposition === "weak_review");
  if (hasReviewable) {
    await setLeadStatus(sb, ctx.leadId, "needs_phone_review");
    return { outcome: "review", candidateIds };
  }
  return { outcome: "continue", candidateIds };
}

// ── Main pipeline ───────────────────────────────────────────────────────────

export async function runEnrichmentPipelineLegacy(
  sb: SupabaseClient,
  ctx: LeadContext,
): Promise<{
  outcome:           "solved" | "review" | "unresolved" | "openclaw_dispatched" | "unsuitable";
  stageReached:      PipelineStage | "preflight" | "none";
  candidateIds:      string[];
  openclawDispatched: boolean;
}> {
  const allCandidateIds: string[] = [];

  await setLeadStatus(sb, ctx.leadId, "enrichment_running");
  await logEvent(sb, ctx.leadId, "enrichment_started", null, {
    enrichment_job_id: ctx.enrichmentJobId,
    has_mailing_addr:  !!ctx.mailingAddress,
    has_property_addr: !!ctx.propertyAddress,
    has_company:       !!ctx.companyName,
    has_director:      !!ctx.fullName,
  });

  // ── Stage 0 — Same-contact existing-phone gate ─────────────────────────
  // If the current contact already has any phone row, skip enrichment entirely.
  const existingPhone = await tryExistingPhoneShortCircuit(sb, ctx);
  if (existingPhone.hit) {
    await logEvent(sb, ctx.leadId, "existing_phone_found", null, {
      phone_e164:  existingPhone.phoneE164 ?? null,
      source:      existingPhone.source ?? null,
      status:      existingPhone.status ?? null,
      confidence:  existingPhone.confidence ?? null,
    });
    await setLeadStatus(sb, ctx.leadId, "ready_to_call");
    await enqueue(sb, ctx.leadId, "briefing", 3);
    await enqueue(sb, ctx.leadId, "fit_score", 3);
    return { outcome: "solved", stageReached: "none", candidateIds: [], openclawDispatched: false };
  }

  // ── Stage 0.5 — Cross-contact portfolio match ───────────────────────────
  // Look for another contact representing the same owner (same normalized name +
  // same postal FSA) that already has a trusted phone (caller_verified or valid).
  const portfolioMatch = await tryCrossContactPortfolioMatch(sb, ctx);

  if (portfolioMatch.ambiguous && portfolioMatch.candidateContactIds) {
    // Two or more qualifying contacts — log for audit and fall through to Brave.
    await logEvent(sb, ctx.leadId, "portfolio_match_ambiguous", null, {
      candidate_contact_ids: portfolioMatch.candidateContactIds,
      fsa: portfolioMatch.fsa ?? null,
    });
    // Fall through — do not short-circuit
  } else if (portfolioMatch.hit && portfolioMatch.matchedContactId && portfolioMatch.matchedPhoneId && portfolioMatch.phoneE164) {
    // One unambiguous match — insert a phone row for the current contact and short-circuit.
    const { matchedContactId, matchedPhoneId, phoneE164, fsa, matchField } = portfolioMatch;

    // Determine matched contact's display name for evidence string
    const { data: matchedContactRow } = await sb
      .from("contacts")
      .select("full_name, company_name")
      .eq("id", matchedContactId)
      .single();
    const matchedFullName =
      (matchedContactRow as { full_name: string | null; company_name: string | null } | null)
        ?.full_name ??
      (matchedContactRow as { full_name: string | null; company_name: string | null } | null)
        ?.company_name ??
      matchedContactId;

    await sb.from("phones").upsert(
      {
        contact_id: ctx.contactId,
        e164:       phoneE164,
        display:    phoneE164,
        source:     "enrichment_other",
        status:     "unverified",
        confidence: 75,
        evidence:   `portfolio match: same owner ${matchedFullName} at FSA ${fsa}`,
        notes:      `stage=portfolio_short_circuit matched_contact_id=${matchedContactId} matched_phone_id=${matchedPhoneId}`,
      },
      { onConflict: "contact_id,e164", ignoreDuplicates: true },
    );

    await logEvent(sb, ctx.leadId, "portfolio_short_circuit_hit", null, {
      matched_contact_id: matchedContactId,
      matched_phone_id:   matchedPhoneId,
      phone_e164:         phoneE164,
      fsa:                fsa ?? null,
      match_field:        matchField ?? null,
    });
    await setLeadStatus(sb, ctx.leadId, "ready_to_call");
    await enqueue(sb, ctx.leadId, "briefing", 3);
    await enqueue(sb, ctx.leadId, "fit_score", 3);
    return { outcome: "solved", stageReached: "none", candidateIds: [], openclawDispatched: false };
  }

  // ── Layer A — Pre-flight ────────────────────────────────────────────────
  const preflight = runPreflight(ctx);
  if (!preflight.ok || !preflight.parsed) {
    await logEvent(sb, ctx.leadId, "preflight_failed", null, {
      failures: preflight.failures, parsed: preflight.parsed,
    });
    await setLeadStatus(sb, ctx.leadId, "unsuitable_for_phone_enrichment");
    return { outcome: "unsuitable", stageReached: "preflight", candidateIds: [], openclawDispatched: false };
  }
  const parsed: ParsedAddress = preflight.parsed;
  await logEvent(sb, ctx.leadId, "preflight_passed", null, { parsed, cityMatch: preflight.cityMatch });

  // ── Stage 1 — Address search ───────────────────────────────────────────
  await setLeadStatus(sb, ctx.leadId, "searching_address");
  await logEvent(sb, ctx.leadId, "address_search_started", "address_search", {
    parsed_address: parsed,
  });

  const addressResult = await runAddressSearch(ctx, parsed).catch(err => {
    console.error("[pipeline] address search error:", err);
    return null;
  });

  if (addressResult) {
    for (const q of addressResult.queries) {
      await logEvent(sb, ctx.leadId, "query_built", "address_search", { variant: q.variant, query: q.query, inputs: q.inputs });
    }
    for (const cls of addressResult.classifications) {
      await logEvent(sb, ctx.leadId, "source_classified", "address_search", {
        host: cls.host, source_class: cls.sourceClass, reason: cls.reason, confidence: cls.confidence,
      });
    }
    await logEvent(sb, ctx.leadId, "address_search_complete", "address_search", {
      total_results: addressResult.totalResults,
      candidates: addressResult.candidates.length,
      auto: addressResult.candidates.filter(c => c.report.disposition === "auto_attached").length,
      review: addressResult.candidates.filter(c => c.report.disposition === "needs_anthony_review").length,
      weak: addressResult.candidates.filter(c => c.report.disposition === "weak_review").length,
      quarantined: addressResult.candidates.filter(c => c.report.disposition === "quarantined").length,
      pipeline_rejected: addressResult.candidates.filter(c => c.report.disposition === "pipeline_rejected").length,
    });

    const { outcome, candidateIds } = await routeStageResult(sb, ctx, addressResult);
    allCandidateIds.push(...candidateIds);
    if (outcome === "solved" || outcome === "review") {
      return { outcome, stageReached: "address_search", candidateIds: allCandidateIds, openclawDispatched: false };
    }
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_address");

  // ── Stage 2 — Company / person search ──────────────────────────────────
  await setLeadStatus(sb, ctx.leadId, "searching_company");
  await logEvent(sb, ctx.leadId, "company_search_started", "company_search", {
    company:  ctx.companyName,
    director: ctx.fullName,
    city:     parsed.city,
  });

  const companyResult = await runCompanySearch(ctx, parsed).catch(err => {
    console.error("[pipeline] company search error:", err);
    return null;
  });

  if (companyResult) {
    for (const q of companyResult.queries) {
      await logEvent(sb, ctx.leadId, "query_built", "company_search", { variant: q.variant, query: q.query, inputs: q.inputs });
    }
    for (const cls of companyResult.classifications) {
      await logEvent(sb, ctx.leadId, "source_classified", "company_search", {
        host: cls.host, source_class: cls.sourceClass, reason: cls.reason, confidence: cls.confidence,
      });
    }
    await logEvent(sb, ctx.leadId, "company_search_complete", "company_search", {
      total_results: companyResult.totalResults,
      candidates: companyResult.candidates.length,
    });

    const { outcome, candidateIds } = await routeStageResult(sb, ctx, companyResult);
    allCandidateIds.push(...candidateIds);
    if (outcome === "solved" || outcome === "review") {
      return { outcome, stageReached: "company_search", candidateIds: allCandidateIds, openclawDispatched: false };
    }
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_company");

  // ── Stage 2.5 — LLM query rewriter ─────────────────────────────────────
  // Only runs when ANTHROPIC_API_KEY is set. No-op otherwise.
  if (process.env.ANTHROPIC_API_KEY) {
    const priorQueries = [
      ...(addressResult?.queries ?? []),
      ...(companyResult?.queries ?? []),
    ].map(q => q.query);

    const rewrittenQueries = await suggestAlternateQueries(ctx, parsed, priorQueries).catch(err => {
      console.error("[pipeline] stage 2.5 query rewriter error:", err);
      return [] as BuiltQuery[];
    });

    if (rewrittenQueries.length > 0) {
      await logEvent(sb, ctx.leadId, "query_built", "address_search", {
        stage_label: "stage_2_5_query_rewriter",
        rewritten_count: rewrittenQueries.length,
        queries: rewrittenQueries.map(q => ({ variant: q.variant, query: q.query })),
      });

      const rewrittenResult = await runQueries(ctx, parsed, rewrittenQueries, "address_search").catch(err => {
        console.error("[pipeline] stage 2.5 brave search error:", err);
        return null;
      });

      if (rewrittenResult) {
        for (const q of rewrittenResult.queries) {
          await logEvent(sb, ctx.leadId, "query_built", "address_search", {
            variant: q.variant, query: q.query, inputs: q.inputs, stage_label: "stage_2_5",
          });
        }
        for (const cls of rewrittenResult.classifications) {
          await logEvent(sb, ctx.leadId, "source_classified", "address_search", {
            host: cls.host, source_class: cls.sourceClass, reason: cls.reason,
            confidence: cls.confidence, stage_label: "stage_2_5",
          });
        }
        await logEvent(sb, ctx.leadId, "address_search_complete", "address_search", {
          stage_label:       "stage_2_5_query_rewriter",
          total_results:     rewrittenResult.totalResults,
          candidates:        rewrittenResult.candidates.length,
          auto:              rewrittenResult.candidates.filter(c => c.report.disposition === "auto_attached").length,
          review:            rewrittenResult.candidates.filter(c => c.report.disposition === "needs_anthony_review").length,
          weak:              rewrittenResult.candidates.filter(c => c.report.disposition === "weak_review").length,
          quarantined:       rewrittenResult.candidates.filter(c => c.report.disposition === "quarantined").length,
          pipeline_rejected: rewrittenResult.candidates.filter(c => c.report.disposition === "pipeline_rejected").length,
        });

        const { outcome, candidateIds } = await routeStageResult(sb, ctx, rewrittenResult);
        allCandidateIds.push(...candidateIds);
        if (outcome === "solved" || outcome === "review") {
          return { outcome, stageReached: "address_search", candidateIds: allCandidateIds, openclawDispatched: false };
        }
      }
    }
  }

  // ── Stage 3 — OpenClaw automated browser research ──────────────────────
  await setLeadStatus(sb, ctx.leadId, "openclaw_researching");
  await logEvent(sb, ctx.leadId, "openclaw_dispatched", "openclaw", {
    prior_candidate_ids: allCandidateIds,
    stages_tried:        ["address_search", "company_search", "stage_2_5_query_rewriter"],
  });

  const { dispatched, reason } = await requestOpenclawDeepSearch(ctx, allCandidateIds);

  if (!dispatched) {
    await setLeadStatus(sb, ctx.leadId, "unresolved_after_openclaw");
    await logEvent(sb, ctx.leadId, "unresolved_after_openclaw", "openclaw", {
      reason: reason ?? "OPENCLAW_WEBHOOK_URL not configured",
    });
    return {
      outcome:            "unresolved",
      stageReached:       "openclaw",
      candidateIds:       allCandidateIds,
      openclawDispatched: false,
    };
  }

  return {
    outcome:            "openclaw_dispatched",
    stageReached:       "openclaw",
    candidateIds:       allCandidateIds,
    openclawDispatched: true,
  };
}

function normalizeQueryToken(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filterAiSecondPassQueries(
  ctx: LeadContext,
  parsed: ParsedAddress,
  suggestedQueries: BuiltQuery[],
  priorQueries: string[],
): BuiltQuery[] {
  const prior = new Set(priorQueries.map(q => normalizeQueryToken(q)).filter(Boolean));
  const propertyCity = normalizeQueryToken(ctx.propertyCity);
  const verifiedCity = normalizeQueryToken(parsed.city ?? ctx.mailingCity);
  const ownerTokens = [
    normalizeQueryToken(ctx.companyName),
    normalizeQueryToken(ctx.fullName),
    normalizeQueryToken(ctx.secondaryName),
  ].filter(token => token.length >= 4);
  const civicStreet = normalizeQueryToken(
    parsed.civicNumber && parsed.streetName ? `${parsed.civicNumber} ${parsed.streetName}` : null,
  );
  const postal = normalizeQueryToken(parsed.postal);

  const out: BuiltQuery[] = [];
  const seen = new Set<string>();
  for (const query of suggestedQueries) {
    const normalized = normalizeQueryToken(query.query);
    if (!normalized || seen.has(normalized) || prior.has(normalized)) continue;
    if (propertyCity && propertyCity !== verifiedCity && normalized.includes(propertyCity)) continue;

    const hasVerifiedAnchor =
      (civicStreet && normalized.includes(civicStreet)) ||
      (postal && normalized.includes(postal)) ||
      ownerTokens.some(token => normalized.includes(token));
    if (!hasVerifiedAnchor) continue;

    seen.add(normalized);
    out.push({
      ...query,
      inputs: {
        ...query.inputs,
        ai_second_pass: "true",
        property_city_filtered: propertyCity && propertyCity !== verifiedCity ? "true" : "false",
      },
    });
    if (out.length >= 4) break;
  }
  return out;
}

export async function runAiSecondPassLegacy(
  sb: SupabaseClient,
  ctx: LeadContext,
  priorQueries: string[],
): Promise<{
  outcome: "solved" | "review" | "unresolved" | "unsuitable";
  candidateIds: string[];
  queriesSuggested: number;
  queriesIssued: number;
  totalResults: number;
}> {
  const preflight = runPreflight(ctx);
  if (!preflight.ok || !preflight.parsed) {
    await logEvent(sb, ctx.leadId, "preflight_failed", null, {
      source: "ai_second_pass",
      failures: preflight.failures,
      parsed: preflight.parsed,
    });
    await setLeadStatus(sb, ctx.leadId, "unsuitable_for_phone_enrichment");
    return { outcome: "unsuitable", candidateIds: [], queriesSuggested: 0, queriesIssued: 0, totalResults: 0 };
  }

  const parsed = preflight.parsed;
  await setLeadStatus(sb, ctx.leadId, "enrichment_running");
  await logEvent(sb, ctx.leadId, "address_search_started", "address_search", {
    stage_label: "ai_second_pass",
    parsed_address: parsed,
    prior_query_count: priorQueries.length,
  });

  const suggested = await suggestAlternateQueries(ctx, parsed, priorQueries).catch(err => {
    console.error("[pipeline] ai second pass query planner error:", err);
    return [] as BuiltQuery[];
  });
  const filtered = filterAiSecondPassQueries(ctx, parsed, suggested, priorQueries);

  await logEvent(sb, ctx.leadId, "query_built", "address_search", {
    stage_label: "ai_second_pass",
    suggested_count: suggested.length,
    accepted_count: filtered.length,
    rejected_count: Math.max(0, suggested.length - filtered.length),
    queries: filtered.map(q => ({ variant: q.variant, query: q.query, inputs: q.inputs })),
  });

  if (filtered.length === 0) {
    await setLeadStatus(sb, ctx.leadId, "unresolved_after_all_sources");
    return { outcome: "unresolved", candidateIds: [], queriesSuggested: suggested.length, queriesIssued: 0, totalResults: 0 };
  }

  const result = await runQueries(ctx, parsed, filtered, "address_search", { useHaiku: true }).catch(err => {
    console.error("[pipeline] ai second pass brave search error:", err);
    return null;
  });

  if (!result) {
    await setLeadStatus(sb, ctx.leadId, "unresolved_after_all_sources");
    return { outcome: "unresolved", candidateIds: [], queriesSuggested: suggested.length, queriesIssued: 0, totalResults: 0 };
  }

  for (const q of result.queries) {
    await logEvent(sb, ctx.leadId, "query_built", "address_search", {
      variant: q.variant,
      query: q.query,
      inputs: q.inputs,
      stage_label: "ai_second_pass",
    });
  }
  for (const cls of result.classifications) {
    await logEvent(sb, ctx.leadId, "source_classified", "address_search", {
      host: cls.host,
      source_class: cls.sourceClass,
      reason: cls.reason,
      confidence: cls.confidence,
      stage_label: "ai_second_pass",
    });
  }
  await logEvent(sb, ctx.leadId, "address_search_complete", "address_search", {
    stage_label: "ai_second_pass",
    total_results: result.totalResults,
    candidates: result.candidates.length,
    auto: result.candidates.filter(c => c.report.disposition === "auto_attached").length,
    review: result.candidates.filter(c => c.report.disposition === "needs_anthony_review").length,
    weak: result.candidates.filter(c => c.report.disposition === "weak_review").length,
    quarantined: result.candidates.filter(c => c.report.disposition === "quarantined").length,
    pipeline_rejected: result.candidates.filter(c => c.report.disposition === "pipeline_rejected").length,
  });

  const routed = await routeStageResult(sb, ctx, result);
  if (routed.outcome === "solved" || routed.outcome === "review") {
    return {
      outcome: routed.outcome,
      candidateIds: routed.candidateIds,
      queriesSuggested: suggested.length,
      queriesIssued: result.queries.length,
      totalResults: result.totalResults,
    };
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_all_sources");
  return {
    outcome: "unresolved",
    candidateIds: routed.candidateIds,
    queriesSuggested: suggested.length,
    queriesIssued: result.queries.length,
    totalResults: result.totalResults,
  };
}
