// Stage 2.5 — LLM query rewriter for the phone enrichment pipeline.
//
// When Stages 1 + 2 both fail to produce any reviewable candidate, this module
// asks Claude Haiku for 2–3 alternate search-query angles and returns them as
// BuiltQuery objects that the pipeline can run through the existing Brave
// search infrastructure.
//
// Graceful no-op: returns [] when the API key is absent or the response cannot
// be parsed, so the pipeline simply falls through to OpenClaw as before.
//
// All calls go through lib/llm/anthropic-client.ts so cost is logged
// automatically under feature "query_rewriting".

import type { LeadContext, ParsedAddress } from "@/lib/enrichment/types";
import type { BuiltQuery } from "@/lib/enrichment/query-builder";
import { callAnthropic, parseFirstJson } from "@/lib/llm/anthropic-client";

// ── Internal JSON shape returned by Haiku ────────────────────────────────────

interface QuerySuggestion {
  query: unknown;
  rationale?: unknown;
}

interface LlmQueryRewriterResponse {
  queries?: QuerySuggestion[];
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM = `You are a Quebec real-estate phone-enrichment assistant.
You receive information about a property owner and their mailing address, plus
the search queries that were already tried without finding a phone number.
Suggest 2–3 alternative Brave web-search queries that may find the owner's
phone from a different angle (different spelling, nearby city synonym, trade
name, related directory, etc.).

Rules:
- Queries must be in French or bilingual, targeting Canadian web sources.
- Prefer phrasing that would match directory listing pages, not news articles.
- Do NOT repeat any of the prior queries verbatim.
- Return ONLY a JSON object, no prose.`;

function buildPrompt(
  ctx: LeadContext,
  parsed: ParsedAddress,
  priorQueries: string[],
): string {
  const owner = ctx.companyName?.trim() || ctx.fullName?.trim() || "(unknown)";
  const address = [
    parsed.civicNumber,
    parsed.streetName,
    parsed.city,
    parsed.province,
    parsed.postal,
  ]
    .filter(Boolean)
    .join(" ");

  const priorBlock =
    priorQueries.length > 0
      ? priorQueries.map(q => `  - ${q}`).join("\n")
      : "  (none)";

  return `Owner / company: ${owner}
Mailing address: ${address}
Prior queries tried (all returned no reviewable phone):
${priorBlock}

Suggest 2–3 alternate Brave search queries that approach the problem differently.
Return EXACTLY this JSON, no prose:
{"queries":[{"query":"...","rationale":"..."},{"query":"...","rationale":"..."}]}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ask Haiku for 2–3 alternate search-query angles given the LeadContext and
 * parsed mailing address. Returns 0–3 BuiltQuery objects with variant
 * "owner_addr_city" (closest existing variant for rewritten queries).
 *
 * Returns [] when the API key is missing or the response is unparseable so the
 * caller can treat the stage as a no-op.
 */
export async function suggestAlternateQueries(
  ctx: LeadContext,
  parsed: ParsedAddress,
  priorQueries: string[],
): Promise<BuiltQuery[]> {
  const result = await callAnthropic({
    feature: "query_rewriting",
    model: "claude-haiku-4-5",
    maxTokens: 400,
    system: SYSTEM,
    prompt: buildPrompt(ctx, parsed, priorQueries),
    leadId: ctx.leadId,
    metadata: {
      prior_query_count: priorQueries.length,
      stage: "stage_2_5",
    },
  });

  if (!result.ok || !result.text) return [];

  const parsed_response = parseFirstJson<LlmQueryRewriterResponse>(result.text);
  if (!parsed_response || !Array.isArray(parsed_response.queries)) return [];

  const owner = ctx.companyName?.trim() || ctx.fullName?.trim() || null;
  const city = parsed.city;

  const out: BuiltQuery[] = [];
  for (const suggestion of parsed_response.queries) {
    if (typeof suggestion.query !== "string") continue;
    const queryStr = suggestion.query.trim();
    if (!queryStr) continue;

    const rationale =
      typeof suggestion.rationale === "string" ? suggestion.rationale.trim() || null : null;

    out.push({
      query: queryStr,
      variant: "owner_addr_city",
      inputs: {
        owner,
        city,
        rewritten: "true",
        rationale,
      },
    });

    if (out.length >= 3) break;
  }

  return out;
}
