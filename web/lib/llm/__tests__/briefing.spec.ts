// Tests for lib/llm/briefing.ts
//
// Mocks callAnthropic so no real HTTP calls are made. The Supabase client is
// also mocked via a chainable query builder stub.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock callAnthropic before importing briefing ────────────────────────────
vi.mock("@/lib/llm/anthropic-client", () => ({
  callAnthropic: vi.fn(),
  parseFirstJson: vi.fn(),
}));

// ── Mock supabase-server so createSupabaseAdminClient doesn't need real env ─
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { generateBriefing } from "@/lib/llm/briefing";
import { callAnthropic } from "@/lib/llm/anthropic-client";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal chainable Supabase stub. */
function makeSupabaseStub(overrides: {
  leadData?: unknown;
  phonesData?: unknown;
  eventsData?: unknown;
  notesData?: unknown;
  leadNoteData?: unknown;
} = {}): SupabaseClient {
  const leadRow = overrides.leadData ?? {
    id: "lead-1",
    status: "ready_to_call",
    contact_id: "contact-1",
    property_id: "prop-1",
    contacts: {
      full_name: "Marie Tremblay",
      company_name: null,
      kind: "individual",
      mailing_address: "14 rue des Lilas",
      mailing_city: "Granby",
      mailing_postal: "J2G 0A1",
      primary_email: null,
    },
    properties: {
      address: "14 rue des Lilas",
      city: "Granby",
      num_units: 14,
      evaluation_total: 2_100_000,
      year_built: 1985,
      matricule: "12345-67-8900",
    },
  };

  const phonesResult = overrides.phonesData ?? [
    { e164: "+15141234567", status: "unverified", source: "enrichment_other" },
  ];

  const eventsResult = overrides.eventsData ?? [
    { event_type: "phone_auto_attached", stage: "address_search", payload: null, created_at: new Date().toISOString() },
  ];

  const notesTableResult = overrides.notesData ?? [];
  const leadNoteResult = overrides.leadNoteData ?? { notes: null };

  // Each from() call returns a chainable query builder that resolves to { data, error }
  const stub = {
    from: vi.fn((table: string) => {
      if (table === "leads") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: leadRow, error: null }),
            }),
          }),
        };
      }
      if (table === "phones") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: phonesResult, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "enrichment_events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: eventsResult, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "notes") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: notesTableResult, error: null }),
              }),
            }),
          }),
        };
      }
      // fallback — used for leads.notes text column (secondary select on leads table)
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: leadNoteResult, error: null }),
          }),
        }),
      };
    }),
  } as unknown as SupabaseClient;

  return stub;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generateBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a briefing when callAnthropic responds with text", async () => {
    const mockCall = vi.mocked(callAnthropic);
    mockCall.mockResolvedValue({
      ok: true,
      text: "Marie Tremblay, propriétaire depuis 2007 d'un complexe de 14 logements à Granby — longue détention suggère une vente liée à la retraite.\n\nQuestion suggérée : Madame Tremblay, avez-vous pensé à alléger votre portefeuille ?",
      inputTokens: 350,
      outputTokens: 80,
      costUsd: 0.0002,
      latencyMs: 800,
      status: 200,
      usageLogId: "log-abc",
    });

    const sb = makeSupabaseStub();
    const result = await generateBriefing("lead-1", sb);

    expect(result).not.toBeNull();
    expect(result!.text).toContain("Marie Tremblay");
    expect(result!.metadata.generatedAt).toBeTruthy();
    expect(result!.metadata.inputTokens).toBe(350);
    expect(mockCall).toHaveBeenCalledOnce();
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "briefing",
        model: "claude-haiku-4-5",
        leadId: "lead-1",
      }),
    );
  });

  it("returns null when callAnthropic returns ok:false (e.g. ANTHROPIC_API_KEY unset)", async () => {
    const mockCall = vi.mocked(callAnthropic);
    mockCall.mockResolvedValue({
      ok: false,
      text: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      status: 0,
      error: "ANTHROPIC_API_KEY not set",
    });

    const sb = makeSupabaseStub();
    const result = await generateBriefing("lead-1", sb);

    expect(result).toBeNull();
    expect(mockCall).toHaveBeenCalledOnce();
  });

  it("returns null when the lead is not found in the DB", async () => {
    const mockCall = vi.mocked(callAnthropic);

    // Lead query returns error
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "leads") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
              }),
            }),
          };
        }
        return { select: vi.fn() };
      }),
    } as unknown as SupabaseClient;

    const result = await generateBriefing("nonexistent-lead", sb);
    expect(result).toBeNull();
    // callAnthropic must NOT have been called
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("passes prompt containing owner name, city and property info", async () => {
    const mockCall = vi.mocked(callAnthropic);
    mockCall.mockResolvedValue({
      ok: true,
      text: "Briefing de test.",
      inputTokens: 300,
      outputTokens: 50,
      costUsd: 0.0001,
      latencyMs: 600,
      status: 200,
    });

    const sb = makeSupabaseStub();
    await generateBriefing("lead-1", sb);

    const callArgs = mockCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Marie Tremblay");
    expect(callArgs.prompt).toContain("Granby");
    expect(callArgs.prompt).toContain("14");           // num_units
    expect(callArgs.prompt).toContain("2100");         // eval (rendered as 2100k$)
    expect(callArgs.maxTokens).toBe(600);
  });

  it("returns null when callAnthropic returns ok:true but empty text", async () => {
    const mockCall = vi.mocked(callAnthropic);
    mockCall.mockResolvedValue({
      ok: true,
      text: "   ",   // blank after trim
      inputTokens: 10,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 200,
      status: 200,
    });

    const sb = makeSupabaseStub();
    const result = await generateBriefing("lead-1", sb);
    expect(result).toBeNull();
  });
});
