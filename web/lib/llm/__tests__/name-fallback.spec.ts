// Tests for the LLM name fallback.
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
import { llmParseName } from "../name-fallback";

const mockCallAnthropic = vi.mocked(callAnthropic);

function makeSuccessResult(json: object) {
  return {
    ok: true,
    text: JSON.stringify(json),
    inputTokens: 15,
    outputTokens: 30,
    costUsd: 0.0015,
    latencyMs: 130,
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

describe("llmParseName", () => {
  it("parses a standard French-Canadian name from a canned LLM response", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      first_name: "Jean",
      last_name: "Tremblay",
      middle_names: [],
      full_name: "Jean Tremblay",
      was_inverted: false,
      parse_quality: "complete",
      notes: [],
      unparseable: false,
    }));

    const result = await llmParseName({ fullName: "TREMBLAY Jean" });

    expect(result).not.toBeNull();
    expect(result!.firstName).toBe("Jean");
    expect(result!.lastName).toBe("Tremblay");
    expect(result!.parseQuality).toBe("complete");
    expect(result!.wasInverted).toBe(false);
  });

  it("corrects an inverted name (prénom/nom swapped)", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      first_name: "Richard",
      last_name: "Lapointe",
      middle_names: [],
      full_name: "Richard Lapointe",
      was_inverted: true,
      parse_quality: "inverted_corrected",
      notes: ["Inversion detected"],
      unparseable: false,
    }));

    const result = await llmParseName({ prenomField: "LAPOINTE", nomField: "Richard" });

    expect(result!.firstName).toBe("Richard");
    expect(result!.lastName).toBe("Lapointe");
    expect(result!.wasInverted).toBe(true);
    expect(result!.parseQuality).toBe("inverted_corrected");
  });

  it("handles a Vietnamese-order name (family first)", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      first_name: "Van An",
      last_name: "Nguyen",
      middle_names: [],
      full_name: "Van An Nguyen",
      was_inverted: false,
      parse_quality: "complete",
      notes: ["Vietnamese naming convention detected: family name first"],
      unparseable: false,
    }));

    const result = await llmParseName({ fullName: "Nguyen Van An" });

    expect(result!.lastName).toBe("Nguyen");
    expect(result!.firstName).toBe("Van An");
    expect(result!.notes.length).toBeGreaterThan(0);
  });

  it("returns null when callAnthropic returns ok:false", async () => {
    mockCallAnthropic.mockResolvedValueOnce(FAILURE_RESULT);

    const result = await llmParseName({ fullName: "Some Name" });
    expect(result).toBeNull();
  });

  it("returns null when Haiku marks the name as unparseable", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      first_name: null,
      last_name: null,
      middle_names: [],
      full_name: null,
      was_inverted: false,
      parse_quality: "unparseable",
      notes: [],
      unparseable: true,
    }));

    const result = await llmParseName({ fullName: "???" });
    expect(result).toBeNull();
  });

  it("returns null for empty input without calling the API", async () => {
    const result = await llmParseName({});
    expect(mockCallAnthropic).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("sanitizes an unrecognized parse_quality to ambiguous", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      first_name: "Test",
      last_name: "User",
      middle_names: [],
      full_name: "Test User",
      was_inverted: false,
      parse_quality: "some_future_value",  // not in the enum
      notes: [],
      unparseable: false,
    }));

    const result = await llmParseName({ fullName: "Test User" });
    expect(result!.parseQuality).toBe("ambiguous");
  });

  it("passes leadId for cost tracking", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      first_name: "A", last_name: "B", middle_names: [], full_name: "A B",
      was_inverted: false, parse_quality: "complete", notes: [], unparseable: false,
    }));

    await llmParseName({ fullName: "A B" }, { leadId: "lead-xyz" });

    expect(mockCallAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-xyz", feature: "name_fallback" }),
    );
  });
});
