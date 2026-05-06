// Tests for the LLM owner-kind fallback.
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
import { llmClassifyOwnerKind } from "../owner-kind-fallback";

const mockCallAnthropic = vi.mocked(callAnthropic);

function makeSuccessResult(json: object) {
  return {
    ok: true,
    text: JSON.stringify(json),
    inputTokens: 8,
    outputTokens: 15,
    costUsd: 0.0005,
    latencyMs: 90,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("llmClassifyOwnerKind", () => {
  it("classifies a natural person from a canned LLM response", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      kind: "person",
      confidence: 95,
      reasoning: "Two-word name with no corporate indicators.",
    }));

    const result = await llmClassifyOwnerKind("Jean Tremblay");
    expect(result).toBe("person");
  });

  it("classifies a company", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      kind: "company",
      confidence: 90,
      reasoning: "Contains 'Gestion' which is a company indicator.",
    }));

    const result = await llmClassifyOwnerKind("Gestion XYZ Ambiguous");
    expect(result).toBe("company");
  });

  it("classifies a numbered company", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      kind: "numbered_co",
      confidence: 99,
      reasoning: "Matches the numbered-company pattern.",
    }));

    const result = await llmClassifyOwnerKind("9876-5432 QUÉBEC INC");
    expect(result).toBe("numbered_co");
  });

  it("classifies a trust (fiducie)", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      kind: "trust",
      confidence: 98,
      reasoning: "Name contains 'Trust' indicating a fiducie structure.",
    }));

    const result = await llmClassifyOwnerKind("Smith Family Trust");
    expect(result).toBe("trust");
  });

  it("returns null when callAnthropic returns ok:false", async () => {
    mockCallAnthropic.mockResolvedValueOnce(FAILURE_RESULT);

    const result = await llmClassifyOwnerKind("Some Ambiguous Name");
    expect(result).toBeNull();
  });

  it("returns null for an empty name without calling the API", async () => {
    const result = await llmClassifyOwnerKind("");
    expect(mockCallAnthropic).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("returns unknown when Haiku cannot determine the kind", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      kind: "unknown",
      confidence: 10,
      reasoning: "Cannot determine from the name alone.",
    }));

    const result = await llmClassifyOwnerKind("???");
    expect(result).toBe("unknown");
  });

  it("sanitizes an unrecognized kind to unknown", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      kind: "government_agency",   // not a valid ContactKind
      confidence: 40,
      reasoning: "Some unexpected value.",
    }));

    const result = await llmClassifyOwnerKind("Some Entity");
    expect(result).toBe("unknown");
  });

  it("passes leadId for cost tracking", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      kind: "person", confidence: 80, reasoning: "Looks like a name.",
    }));

    await llmClassifyOwnerKind("Test Name", { leadId: "lead-123" });

    expect(mockCallAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-123", feature: "owner_kind_fallback" }),
    );
  });
});
