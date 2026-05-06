// LLM-powered format detection for unknown Excel imports.
//
// Called when detectFormat() returns "unknown" and the user has not provided
// a formatOverride. Sends the first ~20 column headers plus 2-3 sample rows
// to Claude Haiku which suggests the most likely rôle format and an optional
// column-mapping when none of the standard formats fit cleanly.
//
// All calls go through lib/llm/anthropic-client.ts so cost is logged
// automatically under feature "format_detection".

import type { RoleFormat } from "@/lib/role-parser/types";
import { callAnthropic, parseFirstJson } from "@/lib/llm/anthropic-client";

export interface FormatSuggestion {
  format: RoleFormat;
  columnMapping?: Record<string, string>;
  confidence: number;    // 0–100
  rationale: string;
}

interface LlmFormatJson {
  format?: string;
  column_mapping?: Record<string, string>;
  confidence?: number;
  rationale?: string;
}

const SYSTEM = `You are an expert in Quebec municipal property roll (rôle d'évaluation) Excel file formats.
There are four known formats:

role_a  — Longueuil/Sherbrooke style. One row per (property, owner) pair.
          Key columns: "Nom propriétaire", "Adresse propriétaire", "Téléphone propriétaire",
          "Adresse" (property), "Matricule".

role_b  — Granby/StHyacinthe/Waterloo style. One row per property, owners in indexed columns.
          Key columns: "Propriétaire1_Nom", "Propriétaire1_Téléphone", "Propriétaire2_Adresse", etc.
          Or Longueuil B2 style with "Propriétaire", "Propriétaire 2", suffix-indexed extras.

role_c  — Sherbrooke style. One row per property, owner info in plain columns.
          Key columns: "Propriétaire", "Téléphone", "Adresse Postale", "Matricule".
          Extras for owner 2+: "Propriétaire 2", "Téléphone 2", etc.

role_d  — Prospection / phone list. NOT a rôle. Owner+phone+address pairs.
          Key columns: "Telephone", "Nom", "Adresse". NO "Matricule" column.

Return ONLY valid JSON, no prose.`;

function buildPrompt(headers: string[], firstRows: Record<string, unknown>[]): string {
  const headerList = headers.slice(0, 20).join(", ");
  const sampleRows = firstRows.slice(0, 3).map((r, i) => {
    const entries = Object.entries(r)
      .slice(0, 20)
      .map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
      .join(",\n");
    return `Row ${i + 1}:\n{\n${entries}\n}`;
  }).join("\n\n");

  return `Analyse the following Excel headers and sample rows from a Quebec property-roll import.

HEADERS (first ${Math.min(headers.length, 20)} of ${headers.length}):
${headerList}

SAMPLE DATA:
${sampleRows || "(no sample rows)"}

Which format does this file most likely represent?

Return JSON with:
- format: one of "role_a" | "role_b" | "role_c" | "role_d" | "unknown"
- column_mapping: object|null — optional map from actual header → canonical field name when the file is non-standard (e.g. {"Owner Name": "Nom propriétaire"})
- confidence: integer 0-100
- rationale: one or two sentences explaining why

Respond with EXACTLY this JSON, no prose:
{"format": "...", "column_mapping": null, "confidence": ..., "rationale": "..."}`;
}

const VALID_FORMATS = new Set<RoleFormat>(["role_a", "role_b", "role_c", "role_d", "unknown"]);

function sanitizeFormat(raw: unknown): RoleFormat {
  if (typeof raw === "string" && VALID_FORMATS.has(raw as RoleFormat)) {
    return raw as RoleFormat;
  }
  return "unknown";
}

/** LLM-powered format suggestion.
 *  Returns null if the API key is not set or the call fails.
 *  Never throws — callers should treat null as "no suggestion available". */
export async function llmSuggestFormat(
  headers: string[],
  firstRows: Record<string, unknown>[],
): Promise<FormatSuggestion | null> {
  if (!headers.length) return null;

  const result = await callAnthropic({
    feature: "format_detection",
    model: "claude-haiku-4-5",
    maxTokens: 400,
    system: SYSTEM,
    prompt: buildPrompt(headers, firstRows),
    metadata: {
      header_count: headers.length,
      sample_row_count: firstRows.length,
      first_headers: headers.slice(0, 10),
    },
  });

  if (!result.ok || !result.text) return null;

  const parsed = parseFirstJson<LlmFormatJson>(result.text);
  if (!parsed) return null;

  const format = sanitizeFormat(parsed.format);
  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
    : 0;
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";

  const columnMapping =
    parsed.column_mapping && typeof parsed.column_mapping === "object"
      ? (parsed.column_mapping as Record<string, string>)
      : undefined;

  return { format, columnMapping, confidence, rationale };
}
