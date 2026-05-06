// LLM fallback for owner-kind classification.
//
// Called when the regex-based classifyOwner() returns "unknown".
// Sends the raw owner name to Claude Haiku which decides whether it is a
// natural person, a company, a numbered company, or a trust.
//
// All calls go through lib/llm/anthropic-client.ts so cost is logged
// automatically under feature "owner_kind_fallback".

import type { ContactKind } from "@/lib/role-parser/types";
import { callAnthropic, parseFirstJson } from "@/lib/llm/anthropic-client";

interface LlmOwnerKindJson {
  kind?: string;
  confidence?: number;
  reasoning?: string;
}

const SYSTEM = `You are a Quebec real-estate contact classifier.
Given an owner name from a Quebec municipal property roll (rôle d'évaluation),
classify it as one of:
- "person"       — a natural person (individual human)
- "company"      — an incorporated company, partnership, or commercial entity
- "numbered_co"  — a numbered company (e.g. "1234-5678 Québec Inc")
- "trust"        — a fiducie or trust
- "unknown"      — cannot determine
Return ONLY valid JSON, no prose.`;

const PROMPT_TEMPLATE = (name: string) =>
  `Classify the following Quebec property-roll owner name.

Owner name: "${name}"

Return JSON with:
- kind: one of "person" | "company" | "numbered_co" | "trust" | "unknown"
- confidence: integer 0-100
- reasoning: one brief sentence

Respond with EXACTLY this JSON, no prose:
{"kind": "...", "confidence": ..., "reasoning": "..."}`;

const VALID_KINDS = new Set<ContactKind>(["person", "company", "numbered_co", "trust", "unknown"]);

function sanitizeKind(raw: unknown): ContactKind {
  if (typeof raw === "string" && VALID_KINDS.has(raw as ContactKind)) {
    return raw as ContactKind;
  }
  return "unknown";
}

/** LLM fallback for owner-kind classification.
 *  Returns null if the API key is not set or the call fails.
 *  Returns "unknown" as a ContactKind when Haiku cannot determine the kind. */
export async function llmClassifyOwnerKind(
  name: string,
  opts: { leadId?: string } = {},
): Promise<ContactKind | null> {
  if (!name || !name.trim()) return null;

  const result = await callAnthropic({
    feature: "owner_kind_fallback",
    model: "claude-haiku-4-5",
    maxTokens: 150,
    system: SYSTEM,
    prompt: PROMPT_TEMPLATE(name.trim()),
    leadId: opts.leadId,
    metadata: { owner_name: name },
  });

  if (!result.ok || !result.text) return null;

  const parsed = parseFirstJson<LlmOwnerKindJson>(result.text);
  if (!parsed) return null;

  return sanitizeKind(parsed.kind);
}
