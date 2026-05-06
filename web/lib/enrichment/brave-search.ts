// Brave Search — v3 enrichment redesign.
//
// runAddressSearch and runCompanySearch now build queries from PARSED address
// fields (Layer B), classify each result (Layer C), extract phones with
// context (Layer D), run gates (Layer E), score multiplicatively, and
// optionally invoke Haiku as G6.
//
// The candidates returned here include their full GateReport. The pipeline
// orchestrator decides whether to auto-attach, queue for review, mark weak,
// or quarantine based on the disposition.
//
// Required env: BRAVE_API_KEY
// Optional env: ANTHROPIC_API_KEY (for G6 Haiku validation)

import type {
  LeadContext, PhoneCandidate, MatchedOn, ParsedAddress,
  GateReport, SourceClassification,
} from "./types";
import { buildAddressQueries, buildCompanyQueries, type BuiltQuery } from "./query-builder";
import { evaluateBraveResult } from "./candidate-evaluator";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  title:       string;
  url:         string;
  description: string;
}
interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

async function braveSearch(query: string): Promise<BraveWebResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error("BRAVE_API_KEY not configured");

  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=10&country=CA&search_lang=fr`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!res.ok) throw new Error(`Brave API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as BraveResponse;
  return data.web?.results ?? [];
}

// ── Public output types ──────────────────────────────────────────────────────

export interface EvaluatedStageResult {
  /** Candidates whose disposition is one of: auto_attached, needs_anthony_review, weak_review, quarantined, pipeline_rejected */
  candidates: Array<PhoneCandidate & { report: GateReport; classification: SourceClassification }>;
  /** Queries actually issued (for the audit log) */
  queries: BuiltQuery[];
  /** Per-result classifications encountered (for the audit log) */
  classifications: SourceClassification[];
  /** Diagnostic — total Brave results received before per-result evaluation */
  totalResults: number;
}

// ── Stage 1 — Address search (uses parsed mailing address) ──────────────────

export async function runAddressSearch(ctx: LeadContext, parsed: ParsedAddress, opts?: { useHaiku?: boolean }): Promise<EvaluatedStageResult> {
  const queries = buildAddressQueries(parsed, ctx);
  return runQueries(ctx, parsed, queries, "address_search", opts);
}

// ── Stage 2 — Company / person search ───────────────────────────────────────

export async function runCompanySearch(ctx: LeadContext, parsed: ParsedAddress, opts?: { useHaiku?: boolean }): Promise<EvaluatedStageResult> {
  const queries = buildCompanyQueries(parsed, ctx);
  return runQueries(ctx, parsed, queries, "company_search", opts);
}

// ── Shared runner ────────────────────────────────────────────────────────────

/**
 * Run a list of pre-built queries through the Brave search pipeline and
 * evaluate the results. Exported so Stage 2.5 (query rewriter) can feed
 * LLM-generated queries without re-deriving them from ctx.
 *
 * @param stage - The pipeline stage label to attach to each candidate.
 *   Pass "address_search" for rewritten queries so they get the same
 *   source-class treatment as address queries.
 */
export async function runQueries(
  ctx: LeadContext,
  parsed: ParsedAddress,
  queries: BuiltQuery[],
  stage: "address_search" | "company_search",
  opts?: { useHaiku?: boolean },
): Promise<EvaluatedStageResult> {
  const allCandidates: Array<PhoneCandidate & { report: GateReport; classification: SourceClassification }> = [];
  const classifications: SourceClassification[] = [];
  const seenE164 = new Set<string>();
  let totalResults = 0;
  const queriesIssued: BuiltQuery[] = [];

  for (const q of queries) {
    let results: BraveWebResult[];
    try { results = await braveSearch(q.query); }
    catch (err) {
      console.error(`[brave-search] query failed: ${q.query}:`, err);
      continue;
    }
    queriesIssued.push(q);
    totalResults += results.length;

    for (const r of results) {
      const evald = await evaluateBraveResult({
        ctx,
        parsedAddress: parsed,
        result: { url: r.url, title: r.title, description: r.description },
        useHaiku: opts?.useHaiku ?? true,
      });
      classifications.push(evald.classification);

      for (const c of evald.candidates) {
        if (c.phone && seenE164.has(c.phone.e164)) continue;
        if (c.phone) seenE164.add(c.phone.e164);

        const matchedOn = pickMatchedOn(c.report, evald.classification);
        allCandidates.push({
          phoneRaw: c.phone?.display ?? "",
          phoneE164: c.phone?.e164 ?? null,
          stage,
          matchedOn,
          sourceLabel: "brave_search",
          sourceUrl: r.url,
          snippet: `${r.title}: ${r.description}`.slice(0, 500),
          searchQuery: q.query,
          candidateName: r.title.slice(0, 200),
          candidateAddress: null,
          relatedEntityName: null,
          relatedEntityType: null,
          initialConfidence: c.report.score,
          report: c.report,
          classification: c.classification,
        });
      }
    }

    // Stop early if we already have a clear high-confidence acceptance.
    const auto = allCandidates.find(c => c.report.disposition === "auto_attached");
    if (auto) break;
    // Stop after we have 3 reviewable candidates.
    const reviewable = allCandidates.filter(c => c.report.disposition === "needs_anthony_review" || c.report.disposition === "auto_attached");
    if (reviewable.length >= 3) break;
  }

  // Sort: auto_attached first, then by score desc.
  allCandidates.sort((a, b) => {
    const wA = dispositionWeight(a.report.disposition);
    const wB = dispositionWeight(b.report.disposition);
    if (wA !== wB) return wB - wA;
    return b.report.score - a.report.score;
  });

  return {
    candidates: allCandidates,
    queries: queriesIssued,
    classifications,
    totalResults,
  };
}

function dispositionWeight(d: GateReport["disposition"]): number {
  switch (d) {
    case "auto_attached":         return 5;
    case "needs_anthony_review":  return 4;
    case "weak_review":           return 3;
    case "quarantined":           return 2;
    case "pipeline_rejected":     return 1;
  }
}

function pickMatchedOn(report: GateReport, classification: SourceClassification): MatchedOn {
  if (classification.sourceClass === "directory_authoritative") return "public_directory";
  if (classification.sourceClass === "company_website") return "company_website";
  const g3 = report.outcomes.find(o => o.gate === "G3_address_match");
  const g4 = report.outcomes.find(o => o.gate === "G4_owner_match");
  const sig3 = g3?.signal as Record<string, unknown> | undefined;
  const sig4 = g4?.signal as Record<string, unknown> | undefined;
  const civicHit = !!sig3?.civicHit;
  const streetHit = !!sig3?.streetHit;
  const ownerHit = !!sig4?.ownerHit;
  const companyHits = typeof sig4?.companyHits === "number" ? sig4.companyHits as number : 0;

  if (civicHit && streetHit && ownerHit) return "address_company";
  if (civicHit && streetHit) return "mailing_address";
  if (ownerHit) return "director_name";
  if (companyHits > 0) return "company_name";
  return "mailing_postal";
}
