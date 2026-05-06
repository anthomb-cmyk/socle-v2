// LLM fallback for the Quebec name parser.
//
// Called when the deterministic name-parser returns parseQuality === "ambiguous"
// or "unparseable". Sends the name input to Claude Haiku which is aware of
// diverse naming conventions (French-Canadian, Cambodian/Khmer, Vietnamese,
// Thai, Hmong, Tamil, Korean, etc.) and returns a structured result.
//
// All calls go through lib/llm/anthropic-client.ts so cost is logged
// automatically under feature "name_fallback".

import type { NameParseQuality } from "@/lib/role-parser/types";
import type { NameParseOutput } from "@/lib/role-parser/name-parser";
import { callAnthropic, parseFirstJson } from "@/lib/llm/anthropic-client";

export interface NameFallbackInput {
  /** Single full-name string (e.g. "TREMBLAY Jean" or "Nguyen Van An") */
  fullName?: string | null;
  /** Separate prénom column value */
  prenomField?: string | null;
  /** Separate nom column value */
  nomField?: string | null;
}

interface LlmNameJson {
  first_name?: string | null;
  last_name?: string | null;
  middle_names?: string[];
  full_name?: string | null;
  was_inverted?: boolean;
  parse_quality?: string;
  notes?: string[];
  unparseable?: boolean;
}

const SYSTEM = `You are a name parser for a Quebec real-estate CRM.
The database holds contacts from Montreal, Longueuil, Sherbrooke, and surroundings.
Many owners have French-Canadian names, but you will also encounter names from:
- Cambodian/Khmer traditions (family name first: "Sok Chantha" → family=Sok, given=Chantha)
- Vietnamese (family name first: "Nguyen Van An" → family=Nguyen, given=Van An)
- Korean (family name first: "Kim Minsu" → family=Kim, given=Minsu)
- Thai (given name first, like Western order)
- Hmong (clan name first)
- Tamil, South Asian (given name first typically)
When in doubt about name order, use parse_quality "ambiguous" and leave as-is.
Return ONLY valid JSON, no prose.`;

function buildPrompt(input: NameFallbackInput): string {
  const lines: string[] = [];
  if (input.fullName) lines.push(`Full name string: "${input.fullName}"`);
  if (input.prenomField) lines.push(`Prénom (first name) column: "${input.prenomField}"`);
  if (input.nomField) lines.push(`Nom (last name) column: "${input.nomField}"`);

  return `Parse the following Quebec contact name and return structured JSON.

${lines.join("\n")}

Return JSON with:
- first_name: string|null       — given/first name
- last_name: string|null        — family/last name
- middle_names: string[]        — middle names moved out of first (may be empty)
- full_name: string|null        — canonical "First Last" display form
- was_inverted: boolean         — true if prénom/nom columns appeared swapped and you corrected them
- parse_quality: string         — one of: "complete", "inverted_corrected", "middle_moved", "ambiguous", "single_token", "unparseable"
- notes: string[]               — brief audit notes (may be empty)
- unparseable: boolean          — true only if the input is completely unusable

Respond with EXACTLY this JSON, no prose:
{"first_name":...,"last_name":...,"middle_names":[...],"full_name":...,"was_inverted":...,"parse_quality":...,"notes":[...],"unparseable":...}`;
}

const VALID_QUALITIES = new Set<NameParseQuality>([
  "complete", "inverted_corrected", "middle_moved", "ambiguous", "single_token", "unparseable",
]);

function sanitizeQuality(raw: unknown): NameParseQuality {
  if (typeof raw === "string" && VALID_QUALITIES.has(raw as NameParseQuality)) {
    return raw as NameParseQuality;
  }
  return "ambiguous";
}

/** LLM fallback name parser.
 *  Returns null if the API key is not set, the call fails, or the input is
 *  marked unparseable by Haiku. */
export async function llmParseName(
  input: NameFallbackInput,
  opts: { leadId?: string } = {},
): Promise<NameParseOutput | null> {
  const hasInput = input.fullName || input.prenomField || input.nomField;
  if (!hasInput) return null;

  const result = await callAnthropic({
    feature: "name_fallback",
    model: "claude-haiku-4-5",
    maxTokens: 300,
    system: SYSTEM,
    prompt: buildPrompt(input),
    leadId: opts.leadId,
    metadata: {
      full_name: input.fullName ?? null,
      prenom: input.prenomField ?? null,
      nom: input.nomField ?? null,
    },
  });

  if (!result.ok || !result.text) return null;

  const parsed = parseFirstJson<LlmNameJson>(result.text);
  if (!parsed) return null;
  if (parsed.unparseable) return null;

  const parseQuality = sanitizeQuality(parsed.parse_quality);

  return {
    firstName: parsed.first_name?.trim() || null,
    lastName: parsed.last_name?.trim() || null,
    middleNames: Array.isArray(parsed.middle_names)
      ? parsed.middle_names.filter(s => typeof s === "string" && s.trim()).map(s => s.trim())
      : [],
    fullName: parsed.full_name?.trim() || null,
    wasInverted: !!parsed.was_inverted,
    parseQuality,
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.filter(s => typeof s === "string").map(s => s.trim())
      : [],
  };
}
