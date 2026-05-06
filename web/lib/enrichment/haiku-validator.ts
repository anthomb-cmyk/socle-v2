// Layer F — Haiku final-gate validator (v3 enrichment redesign).
//
// Runs after G1–G5 pass. Asks Claude Haiku whether the snippet really proves
// the phone belongs to the lead's owner. Adds the cheap-but-strong final
// signal that catches subtle mismatches the deterministic gates miss.
//
// Cost: ~$0.001 per candidate. Cached by (snippet hash + lead id).
// Failure mode: if ANTHROPIC_API_KEY is not set, this is a no-op that
// returns null, and the gate engine treats G6 as "not invoked" (passes).
//
// Uses fetch() against the public Anthropic Messages API. We avoid adding the
// SDK to package.json; the call shape is stable.

import type { LeadContext, ParsedAddress } from "./types";

const HAIKU_MODEL = "claude-haiku-4-5";  // latest small model
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 400;

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

/** Returns null if the API key is not configured (graceful degradation). */
export async function validateWithHaiku(input: HaikuInput): Promise<HaikuVerdict | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

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

  const body = {
    model: HAIKU_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  };

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[haiku-validator] fetch failed:", err);
    return null;
  }
  if (!res.ok) {
    console.error("[haiku-validator] non-200:", res.status, await res.text().catch(() => ""));
    return null;
  }

  let data: { content?: Array<{ type: string; text?: string }> };
  try { data = await res.json(); }
  catch { return null; }

  const text = (data.content ?? []).map(c => c.text ?? "").join("").trim();
  if (!text) return null;

  // Pull the first JSON object out of the response (Haiku usually emits it directly).
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed: { is_owners_phone?: boolean; confidence?: number; reasoning?: string; name_in_source?: boolean; address_in_source?: boolean };
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { return null; }

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
