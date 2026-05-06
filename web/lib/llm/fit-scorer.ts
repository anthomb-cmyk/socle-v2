// Lead fit scorer — evaluates how well a lead matches the investment thesis.
//
// Calls Claude Haiku with the INVESTMENT_THESIS + lead context and returns
// a 0-100 score with reasoning. Updates leads.fit_score / fit_reasoning /
// fit_scored_at on success. Returns null on any failure (graceful degradation).

import type { SupabaseClient } from "@supabase/supabase-js";
import { callAnthropic, parseFirstJson } from "@/lib/llm/anthropic-client";
import { INVESTMENT_THESIS } from "@/lib/llm/investment-thesis";

// ── Types ────────────────────────────────────────────────────────────────────

interface FitScoreJson {
  score: number;
  reasoning: string;
}

type LeadRow = {
  id: string;
  contact_id: string | null;
  contacts: {
    full_name: string | null;
    company_name: string | null;
    kind: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
  } | null;
  properties: {
    address: string | null;
    city: string | null;
    num_units: number | null;
    evaluation_total: number | null;
    year_built: number | null;
  } | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildPrompt(lead: LeadRow): string {
  const contact = lead.contacts;
  const property = lead.properties;

  const ownerName = contact?.full_name ?? contact?.company_name ?? "Unknown";
  const ownerKind = contact?.kind ?? "unknown";
  const propCity = property?.city ?? "unknown";
  const numUnits = property?.num_units ?? null;
  const evalTotal = property?.evaluation_total ?? null;
  const yearBuilt = property?.year_built ?? null;
  const propAddress = property?.address ?? "unknown";
  const mailingAddr = [contact?.mailing_address, contact?.mailing_city, contact?.mailing_postal]
    .filter(Boolean).join(", ") || "unknown";

  const valPerUnit =
    numUnits && numUnits > 0 && evalTotal
      ? Math.round(evalTotal / numUnits)
      : null;

  const currentYear = new Date().getFullYear();
  const propertyAge = yearBuilt ? currentYear - yearBuilt : null;

  const leadContext = [
    `Owner: ${ownerName} (type: ${ownerKind})`,
    `Property address: ${propAddress}, ${propCity}`,
    numUnits !== null ? `Units: ${numUnits}` : null,
    evalTotal !== null ? `Municipal valuation: $${Math.round(evalTotal / 1000)}k CAD` : null,
    valPerUnit !== null ? `Valuation per unit: $${valPerUnit.toLocaleString("en-CA")} CAD` : null,
    yearBuilt !== null ? `Year built: ${yearBuilt} (${propertyAge} years old)` : null,
    `Owner mailing address: ${mailingAddr}`,
    mailingAddr !== "unknown" && propCity !== "unknown" && !mailingAddr.includes(propCity)
      ? "Note: mailing address appears to differ from property city (possible out-of-town landlord)"
      : null,
  ].filter(Boolean).join("\n");

  return `You are evaluating a real estate lead against an investment thesis.

INVESTMENT THESIS:
${JSON.stringify(INVESTMENT_THESIS, null, 2)}

LEAD DATA:
${leadContext}

Score this lead from 0 to 100 based on how well it matches the thesis.
- 80-100: Excellent fit (most positive signals present, few negatives)
- 60-79: Good fit (several positive signals)
- 40-59: Moderate fit (mixed signals)
- 20-39: Poor fit (mostly negative signals)
- 0-19: Very poor fit (strong disqualifiers)

Respond with ONLY this JSON, no prose:
{"score": <integer 0-100>, "reasoning": "<2-3 sentence explanation in English>"}`;
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function scoreLeadFit(
  leadId: string,
  sb: SupabaseClient,
): Promise<{ score: number; reasoning: string } | null> {
  // 1. Fetch lead joined with property + contact
  const { data: leadRaw, error: leadErr } = await sb
    .from("leads")
    .select(`
      id, contact_id,
      contacts ( full_name, company_name, kind, mailing_address, mailing_city, mailing_postal ),
      properties ( address, city, num_units, evaluation_total, year_built )
    `)
    .eq("id", leadId)
    .single();

  if (leadErr || !leadRaw) {
    console.error("[fit-scorer] lead fetch failed:", leadErr?.message);
    return null;
  }
  const lead = leadRaw as unknown as LeadRow;

  // 2. Build prompt
  const prompt = buildPrompt(lead);

  // 3. Call Haiku
  const result = await callAnthropic({
    feature: "deal_fit_score",
    model: "claude-haiku-4-5",
    maxTokens: 300,
    prompt,
    leadId,
  });

  if (!result.ok || !result.text) {
    console.error("[fit-scorer] callAnthropic failed:", result.error);
    return null;
  }

  // 4. Parse JSON response
  const parsed = parseFirstJson<FitScoreJson>(result.text);
  if (!parsed || typeof parsed.score !== "number" || !parsed.reasoning) {
    console.error("[fit-scorer] failed to parse response:", result.text);
    return null;
  }

  // Clamp score to 0-100
  const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
  const reasoning = parsed.reasoning;

  // 5. Update lead record
  const { error: updateErr } = await sb
    .from("leads")
    .update({
      fit_score: score,
      fit_reasoning: reasoning,
      fit_scored_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (updateErr) {
    console.error("[fit-scorer] lead update failed:", updateErr.message);
    // Still return the result even if DB update failed
  }

  // 6. Return result
  return { score, reasoning };
}
