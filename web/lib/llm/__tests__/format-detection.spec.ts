// Tests for the LLM format-detection helper.
// callAnthropic is mocked so no network calls are made.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/anthropic-client", () => ({
  callAnthropic: vi.fn(),
  parseFirstJson: (text: string) => {
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); }
    catch { return null; }
  },
}));

import { callAnthropic } from "@/lib/llm/anthropic-client";
import { llmSuggestFormat } from "../format-detection";

const mockCallAnthropic = vi.mocked(callAnthropic);

function makeSuccessResult(json: object) {
  return {
    ok: true,
    text: JSON.stringify(json),
    inputTokens: 50,
    outputTokens: 60,
    costUsd: 0.002,
    latencyMs: 200,
    status: 200,
  };
}

const FAILURE_RESULT = {
  ok: false,
  text: "",
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  status: 0,
  error: "ANTHROPIC_API_KEY not set",
};

const SAMPLE_HEADERS_B = [
  "Matricule",
  "Adresse Immeuble",
  "Ville",
  "Propriétaire1_Nom",
  "Propriétaire1_Téléphone",
  "Propriétaire1_Adresse",
  "Propriétaire2_Nom",
  "Propriétaire2_Téléphone",
];

const SAMPLE_ROWS_B = [
  {
    Matricule: "1234567890",
    "Adresse Immeuble": "3661-3667 rue de Mont-Royal",
    Ville: "Longueuil",
    "Propriétaire1_Nom": "Jean Tremblay",
    "Propriétaire1_Téléphone": "450-555-1234",
    "Propriétaire1_Adresse": "3661 rue de Mont-Royal, Longueuil QC J4T 2G9",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("llmSuggestFormat", () => {
  it("suggests role_b from a canned LLM response", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      format: "role_b",
      column_mapping: null,
      confidence: 88,
      rationale: "Columns are prefix-indexed with 'Propriétaire1_Nom' pattern typical of Format B.",
    }));

    const result = await llmSuggestFormat(SAMPLE_HEADERS_B, SAMPLE_ROWS_B);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("role_b");
    expect(result!.confidence).toBe(88);
    expect(result!.rationale).toContain("Format B");
    expect(result!.columnMapping).toBeUndefined();
  });

  it("returns a column mapping suggestion when provided", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      format: "role_a",
      column_mapping: { "Owner": "Nom propriétaire", "Address": "Adresse propriétaire" },
      confidence: 70,
      rationale: "Looks like Format A but with English column names.",
    }));

    const result = await llmSuggestFormat(["Owner", "Address", "Matricule"], []);

    expect(result!.format).toBe("role_a");
    expect(result!.columnMapping).toEqual({
      "Owner": "Nom propriétaire",
      "Address": "Adresse propriétaire",
    });
    expect(result!.confidence).toBe(70);
  });

  it("returns null when callAnthropic returns ok:false", async () => {
    mockCallAnthropic.mockResolvedValueOnce(FAILURE_RESULT);

    const result = await llmSuggestFormat(SAMPLE_HEADERS_B, SAMPLE_ROWS_B);
    expect(result).toBeNull();
  });

  it("returns null for empty headers without calling the API", async () => {
    const result = await llmSuggestFormat([], []);
    expect(mockCallAnthropic).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("clamps confidence to [0, 100]", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      format: "role_c",
      column_mapping: null,
      confidence: 150,   // out of range
      rationale: "Looks like Format C.",
    }));

    const result = await llmSuggestFormat(["Propriétaire", "Téléphone", "Matricule"], []);
    expect(result!.confidence).toBe(100);
  });

  it("sanitizes an unrecognized format to unknown", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      format: "role_z",  // not a valid RoleFormat
      column_mapping: null,
      confidence: 30,
      rationale: "Could not determine.",
    }));

    const result = await llmSuggestFormat(["SomeHeader"], []);
    expect(result!.format).toBe("unknown");
  });

  it("passes feature: format_detection to callAnthropic", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      format: "role_b", column_mapping: null, confidence: 80, rationale: "OK",
    }));

    await llmSuggestFormat(["Col1"], []);

    expect(mockCallAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "format_detection" }),
    );
  });
});
