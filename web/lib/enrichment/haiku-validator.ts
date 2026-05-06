// Layer F — Haiku final-gate validator (v3 enrichment redesign).
//
// Runs after G1–G5 pass. Asks Claude Haiku whether the snippet really proves
// the phone belongs to the lead's owner. Adds the cheap-but-strong final
// signal that catches subtle mismatches the deterministic gates miss.
//
// All calls go through lib/llm/anthropic-client.ts so cost is logged into
// llm_usage_log automatically. Failure mode: if ANTHROPIC_API_KEY is not set,
// the client returns ok:false and we return null, letting the gate engine
// treat G6 as "not invoked" (passes).

import type { LeadContext, ParsedAddress } from "./types";
import { callAnthropic, parseFirstJson } from "@/lib/llm/anthropic-client";

export interface HaikuVerdict {
  isOwnersPhone: boolean;
  confidence: number;     // 0–100
  reasoning: string;
  nameInSource: boolean;
  addressInSource: boolean;
}

export interface HaikuInput {
  ctx: LeadContext;
  parsedAddress: ParsedAddress;
  phone: string;          // E.164 or display
  url: string;
  title: string;
  snippet: string;
}

/** Returns null if the API key is not configured or the call fails. */
export async function validateWithHaiku(input: HaikuInput): Promise<HaikuVerdict | null> {
  const ownerName = input.ctx.fullName ?? input.ctx.companyName ?? "(unknown)";
  const company = input.ctx.companyName ?? "(none)";
  const mailingAddr = input.parsedAddress.civicNumber && input.parsedAddress.streetName
    ? `${input.parsedAddress.civicNumber} ${input.parsedAddress.streetName}`
    : (input.ctx.mailingAddress ?? "(none)");
  const mailingCity = input.parsedAddress.city ?? input.ctx.mailingCity ?? "(none)";
  const mailingPostal = input.parsedAddress.postal ?? input.ctx.mailingPostal ?? "(none)";

  const prompt = `You are validating a phone number candidate for a Quebec real-estate CRM.

OWNER (the person/entity whose phone we want):
- Name: ${ownerName}
- Company: ${company}
- Mailing address: ${mailingAddr}, ${mailingCity} ${mailingPostal}

CANDIDATE PHONE: ${input.phone}
SOURCE URL: ${input.url}
SOURCE TITLE: ${input.title}
SOURCE SNIPPET: ${input.snippet}

QUESTION: Does the source clearly establish that this phone number belongs to the owner above (the same person/entity, at the same mailing address)?

Be strict. Reject if:
- The snippet is about a DIFFERENT person, business, tenant, neighbour, or institution.
- The address in the snippet doesn't match the owner's mailing address (different civic number, different city, different postal code).
- The page is a directory category, store locator, government bulk list, or a generic municipal/institutional contact page.
- The number is labelled fax, NEQ, or business registration.
- The match is just a numeric coincidence.

Respond with EXACTLY this JSON, no prose:
{"is_owners_phone": <bool>, "confidence": <0-100 integer>, "name_in_source": <bool>, "address_in_source": <bool>, "reasoning": "<one sentence>"}`;

  const result = await callAnthropic({
    feature: "g6_haiku_validation",
    model: "claude-haiku-4-5",
    maxTokens: 400,
    prompt,
    leadId: input.ctx.leadId,
    metadata: { phone: input.phone, url: input.url },
  });
  if (!result.ok || !result.text) return null;

  const parsed = parseFirstJson<{
    is_owners_phone?: boolean; confidence?: number; reasoning?: string;
    name_in_source?: boolean; address_in_source?: boolean;
  }>(result.text);
  if (!parsed) return null;

  return {
    isOwnersPhone: !!parsed.is_owners_phone,
    confidence: clampInt(parsed.confidence ?? 0, 0, 100),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    nameInSource: !!parsed.name_in_source,
    addressInSource: !!parsed.address_in_source,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
