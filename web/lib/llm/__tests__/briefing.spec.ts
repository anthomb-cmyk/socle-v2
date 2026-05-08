// Tests for lib/llm/briefing.ts
//
// Two test suites:
//   1. Legacy generateBriefing — mocks callAnthropic + Supabase (unchanged tests).
//   2. Phase 8 — renderBriefingTemplate, renderBriefingPhrased, detectLanguage.
//
// No real HTTP calls are made anywhere in this file.

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

import {
  generateBriefing,
  renderBriefingTemplate,
  renderBriefingPhrased,
  detectLanguage,
  type BriefingInput,
} from "@/lib/llm/briefing";
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

/** Minimal valid Pipeline A input */
function makePipelineAInput(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    pipeline: "A",
    owner: {
      canonicalName: "GESTION TREMBLAY INC",
      ownerType: "named_co",
      neq: "1234567890",
      mailingAddress: "100 rue Principale, Sherbrooke",
      mailingIsProperty: false,
    },
    reqDirector: { name: "Jean Tremblay", year: 2018 },
    properties: [
      {
        matricule: "111-222-333",
        address: "100 rue Principale",
        city: "Sherbrooke",
        nUnits: 12,
        assessmentTotal: 1_500_000,
        yearBuilt: 1988,
      },
      {
        matricule: "444-555-666",
        address: "200 boul. des Érables",
        city: "Longueuil",
        nUnits: 8,
        assessmentTotal: 900_000,
        yearBuilt: 2001,
      },
    ],
    primaryPhone: { e164: "+15141234567", tier: "A", label: "confirmed", isDirect: true },
    primarySource: "req_phone",
    secondarySource: "pages_jaunes",
    whatsInteresting: null,
    language: "en",
    ...overrides,
  };
}

/** Minimal valid Pipeline B input */
function makePipelineBInput(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    pipeline: "B",
    owner: {
      canonicalName: "John Smith",
      ownerType: "individual",
    },
    directorOfOther: [{ name: "Gestion Smith Inc." }],
    properties: [
      {
        matricule: "777-888-999",
        address: "55 av. Victoria",
        city: "Montréal",
        nUnits: 6,
        assessmentTotal: 800_000,
        yearBuilt: 1975,
      },
    ],
    primaryPhone: { e164: "+15149876543", tier: "B", label: "likely", isDirect: true },
    primarySource: "canada411",
    secondarySource: null,
    whatsInteresting: "Old property with high per-unit assessment.",
    language: "en",
    ...overrides,
  };
}

// ── Legacy tests (generateBriefing) ──────────────────────────────────────────

describe("generateBriefing (legacy)", () => {
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

// ── detectLanguage ────────────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("detects French from diacritics — 'Société Générale'", () => {
    expect(detectLanguage("Société Générale")).toBe("fr");
  });

  it("detects French from given name — 'Pierre Tremblay'", () => {
    expect(detectLanguage("Pierre Tremblay")).toBe("fr");
  });

  it("detects English — 'John Smith'", () => {
    expect(detectLanguage("John Smith")).toBe("en");
  });

  it("detects French from surname suffix -eau — 'Robert Thibodeau'", () => {
    expect(detectLanguage("Robert Thibodeau")).toBe("fr");
  });

  it("detects French from given name — 'Jean-Pierre Bouchard'", () => {
    expect(detectLanguage("Jean-Pierre Bouchard")).toBe("fr");
  });

  it("detects English for an all-caps numbered company — '9234567 CANADA INC'", () => {
    expect(detectLanguage("9234567 CANADA INC")).toBe("en");
  });
});

// ── renderBriefingTemplate — Pipeline A ──────────────────────────────────────

describe("renderBriefingTemplate — Pipeline A", () => {
  it("renders all sections deterministically (en)", () => {
    const input = makePipelineAInput();
    const text = renderBriefingTemplate(input);

    expect(text).toContain("Owner: GESTION TREMBLAY INC (NEQ 1234567890).");
    expect(text).toContain("Director per REQ: Jean Tremblay, registered 2018.");
    expect(text).toContain("Holds 2 buildings totaling 20 units in Sherbrooke, Longueuil");
    expect(text).toContain("assessed at");
    expect(text).toContain("$2,400,000"); // 1_500_000 + 900_000
    expect(text).toContain("Largest:");
    expect(text).toContain("100 rue Principale");
    expect(text).toContain("Phone: (514) 123-4567");
    expect(text).toContain("sourced from req_phone");
    expect(text).toContain("corroborated by pages_jaunes");
    expect(text).toContain("Confidence: confirmed.");
  });

  it("renders mailingIsProperty branch", () => {
    const input = makePipelineAInput({
      owner: {
        canonicalName: "GESTION TREMBLAY INC",
        ownerType: "named_co",
        neq: "1234567890",
        mailingAddress: "100 rue Principale, Sherbrooke",
        mailingIsProperty: true,
      },
    });
    const text = renderBriefingTemplate(input);
    expect(text).toContain("100 rue Principale, Sherbrooke");
    expect(text).toContain("operates from home");
  });

  it("renders connected-phone (isDirect=false) wording", () => {
    const input = makePipelineAInput({
      primaryPhone: { e164: "+15141234567", tier: "D", label: "connected", isDirect: false },
    });
    const text = renderBriefingTemplate(input);
    expect(text).toContain("rings at");
    expect(text).toContain("mark wrong_number");
    expect(text).not.toContain("sourced from");
  });

  it("renders single-source (no corroboration) wording", () => {
    const input = makePipelineAInput({ secondarySource: null });
    const text = renderBriefingTemplate(input);
    expect(text).toContain("sourced from req_phone");
    expect(text).not.toContain("corroborated");
  });

  it("renders without reqDirector when omitted", () => {
    const input = makePipelineAInput({ reqDirector: null });
    const text = renderBriefingTemplate(input);
    expect(text).not.toContain("Director per REQ");
  });

  it("includes whatsInteresting when provided", () => {
    const input = makePipelineAInput({ whatsInteresting: "Director listing changed in March 2024." });
    const text = renderBriefingTemplate(input);
    expect(text).toContain("Director listing changed in March 2024.");
  });

  it("uses fr-CA currency formatting for French language path", () => {
    const input = makePipelineAInput({ language: "fr" });
    const text = renderBriefingTemplate(input);
    // fr-CA formats as "2 400 000 $" (narrow non-breaking space or regular space)
    // We just check for the $ sign appearing after the number (French convention)
    expect(text).toMatch(/\d.*\$/);
    expect(text).toContain("Propriétaire :");
  });
});

// ── renderBriefingTemplate — Pipeline B ──────────────────────────────────────

describe("renderBriefingTemplate — Pipeline B", () => {
  it("renders all sections deterministically (en)", () => {
    const input = makePipelineBInput();
    const text = renderBriefingTemplate(input);

    expect(text).toContain("Owner: John Smith, individual.");
    expect(text).toContain("Listed as director of Gestion Smith Inc.");
    expect(text).toContain("Holds 1 building totaling 6 units in Montréal");
    expect(text).toContain("Phone: (514) 987-6543 (direct line per canada411).");
    expect(text).toContain("Caller: verify it's them before mentioning real estate.");
    expect(text).toContain("Confidence: likely.");
    expect(text).toContain("Old property with high per-unit assessment.");
  });

  it("renders Pipeline B without directorOfOther", () => {
    const input = makePipelineBInput({ directorOfOther: null });
    const text = renderBriefingTemplate(input);
    expect(text).not.toContain("director of");
  });

  it("renders Pipeline B with secondarySource", () => {
    const input = makePipelineBInput({ secondarySource: "reverse_lookup" });
    const text = renderBriefingTemplate(input);
    expect(text).toContain("+ reverse_lookup");
  });
});

// ── renderBriefingPhrased ────────────────────────────────────────────────────

describe("renderBriefingPhrased", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure ANTHROPIC_API_KEY is unset for fallback tests
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns template text when ANTHROPIC_API_KEY is not set (snapshot match)", async () => {
    const input = makePipelineBInput();
    const templateText = renderBriefingTemplate(input);
    const phrasedText = await renderBriefingPhrased(input);
    expect(phrasedText).toBe(templateText);
  });

  it("returns phrased text when mocked Anthropic client returns response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const mockCall = vi.mocked(callAnthropic);
    mockCall.mockResolvedValue({
      ok: true,
      text: "John Smith is an individual owner with a 6-unit building in Montréal.",
      inputTokens: 120,
      outputTokens: 30,
      costUsd: 0.00005,
      latencyMs: 400,
      status: 200,
    });

    const input = makePipelineBInput();
    const result = await renderBriefingPhrased(input);

    expect(result).toBe("John Smith is an individual owner with a 6-unit building in Montréal.");
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "briefing",
        model: "claude-haiku-4-5-20251001",
        maxTokens: 2000,
      }),
    );
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back to template when API returns ok:false", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const mockCall = vi.mocked(callAnthropic);
    mockCall.mockResolvedValue({
      ok: false,
      text: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      status: 429,
      error: "Rate limited",
    });

    const input = makePipelineBInput();
    const templateText = renderBriefingTemplate(input);
    const result = await renderBriefingPhrased(input);
    expect(result).toBe(templateText);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back to template when API throws", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const mockCall = vi.mocked(callAnthropic);
    mockCall.mockRejectedValue(new Error("Network error"));

    const input = makePipelineBInput();
    const templateText = renderBriefingTemplate(input);
    const result = await renderBriefingPhrased(input);
    expect(result).toBe(templateText);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
