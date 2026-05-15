import { beforeEach, describe, expect, it, vi } from "vitest";

const importJobId = "11111111-1111-4111-8111-111111111111";
const leadId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";

const requireAdminMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn();
const getOperatorEnabledMock = vi.fn();
const getBudgetStatusMock = vi.fn();
const getEligibleStartLeadIdsMock = vi.fn();
const getImportLeadIdsMock = vi.fn();
const leadBelongsToImportMock = vi.fn();
const buildReviewProposalMock = vi.fn();
const assertBudgetCanSpendMock = vi.fn();
const estimatePhoneEnrichmentAiCostUsdMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

vi.mock("@/lib/phone-enrichment/session", () => ({
  assertBudgetCanSpend: assertBudgetCanSpendMock,
  buildReviewProposal: buildReviewProposalMock,
  estimatePhoneEnrichmentAiCostUsd: estimatePhoneEnrichmentAiCostUsdMock,
  getBudgetStatus: getBudgetStatusMock,
  getEligibleStartLeadIds: getEligibleStartLeadIdsMock,
  getImportLeadIds: getImportLeadIdsMock,
  getOperatorEnabled: getOperatorEnabledMock,
  leadBelongsToImport: leadBelongsToImportMock,
}));

type MockState = {
  importExists?: boolean;
  priorActions?: Array<Record<string, unknown>>;
  insertedEvents: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  phoneCandidates?: Array<Record<string, unknown>>;
  updates: Array<{ table: string; patch: Record<string, unknown> }>;
  insertedRows: Array<{ table: string; row: Record<string, unknown> }>;
};

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:8985/api/phone-enrichment/sessions/${importJobId}/codex-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "socle-test=1", ...headers },
    body: JSON.stringify(body),
  });
}

function makeCtx() {
  return { params: Promise.resolve({ importJobId }) };
}

function makeSingleQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function makeListQuery(data: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null }),
  };
  return query;
}

function makeUpdateQuery(state: MockState, table: string, patch: Record<string, unknown>) {
  return {
    eq: vi.fn().mockImplementation(() => {
      state.updates.push({ table, patch });
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

function makeInsertQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function makeSupabase(state: MockState) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === "import_jobs") {
          return makeSingleQuery(state.importExists === false ? null : { id: importJobId });
        }
        if (table === "automation_events") {
          return makeListQuery(state.priorActions ?? []);
        }
        if (table === "enrichment_jobs") {
          return makeListQuery(state.jobs ?? []);
        }
        if (table === "phone_candidates") {
          return makeListQuery(state.phoneCandidates ?? []);
        }
        return makeListQuery([]);
      }),
      insert: vi.fn((row: Record<string, unknown>) => {
        state.insertedRows.push({ table, row });
        if (table === "automation_events") state.insertedEvents.push(row);
        return makeInsertQuery({ id: "event-1", occurred_at: "2026-05-15T00:00:00.000Z" });
      }),
      update: vi.fn((patch: Record<string, unknown>) => makeUpdateQuery(state, table, patch)),
    })),
  };
}

async function readJson(res: Response) {
  return res.json() as Promise<{ ok: boolean; error?: string; code?: string; data?: Record<string, unknown> }>;
}

describe("codex-action route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "99999999-9999-4999-8999-999999999999" } });
    getOperatorEnabledMock.mockReturnValue(true);
    getBudgetStatusMock.mockResolvedValue({
      dailyBudgetUsd: 20,
      sessionBudgetUsd: 5,
      dailySpentUsd: 0,
      sessionSpentUsd: 0,
      dailyRemainingUsd: 20,
      sessionRemainingUsd: 5,
      overDailyBudget: false,
      overSessionBudget: false,
    });
    getEligibleStartLeadIdsMock.mockResolvedValue([leadId]);
    getImportLeadIdsMock.mockResolvedValue([leadId]);
    leadBelongsToImportMock.mockResolvedValue(true);
    estimatePhoneEnrichmentAiCostUsdMock.mockReturnValue(0.005);
    assertBudgetCanSpendMock.mockReturnValue({ ok: true });
    buildReviewProposalMock.mockImplementation((candidate: { id: string }) => ({
      candidateId: candidate.id,
      proposedDecision: "manual_review",
      verdict: "Needs Anthony",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { counts: { created: 1, skipped: 0, failed: 0 }, results: [{ leadId, status: "created" }] } }),
    }));
  });

  it("refuses writes when operator mode is disabled", async () => {
    const state: MockState = { insertedEvents: [], updates: [], insertedRows: [] };
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(state));
    getOperatorEnabledMock.mockReturnValue(false);
    const { POST } = await import("../route");

    const res = await POST(makeRequest({ action_type: "start_enrichment" }), makeCtx());
    const json = await readJson(res);

    expect(res.status).toBe(403);
    expect(json.code).toBe("operator_disabled");
    expect(state.insertedEvents).toHaveLength(0);
  });

  it("dedupes by idempotency key before doing work", async () => {
    const state: MockState = {
      insertedEvents: [],
      updates: [],
      insertedRows: [],
      priorActions: [{ id: "prior-1", payload: { codex: { idempotency_key: "same-key" } } }],
    };
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(state));
    const { POST } = await import("../route");

    const res = await POST(makeRequest({ action_type: "start_enrichment", idempotency_key: "same-key" }), makeCtx());
    const json = await readJson(res);

    expect(res.status).toBe(200);
    expect(json.data?.duplicate).toBe(true);
    expect(getEligibleStartLeadIdsMock).not.toHaveBeenCalled();
    expect(state.insertedEvents).toHaveLength(0);
  });

  it("rejects unsupported actions and actor spoofing", async () => {
    const state: MockState = { insertedEvents: [], updates: [], insertedRows: [] };
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(state));
    const { POST } = await import("../route");

    const unsupported = await readJson(await POST(makeRequest({ action_type: "approve_phone_candidate" }), makeCtx()));
    const spoofed = await readJson(await POST(makeRequest({ action_type: "start_enrichment", actor_kind: "codex" }), makeCtx()));

    expect(unsupported.ok).toBe(false);
    expect(spoofed.ok).toBe(false);
    expect(state.insertedEvents).toHaveLength(0);
  });

  it("logs actor_kind=codex with payload.codex metadata for start_enrichment", async () => {
    const state: MockState = { insertedEvents: [], updates: [], insertedRows: [] };
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(state));
    const { POST } = await import("../route");

    const res = await POST(makeRequest({
      action_type: "start_enrichment",
      idempotency_key: "start-once",
    }), makeCtx());
    const json = await readJson(res);

    expect(res.status).toBe(200);
    expect(json.data?.actionType).toBe("start_enrichment");
    expect(state.insertedEvents).toHaveLength(1);
    expect(state.insertedEvents[0]).toMatchObject({
      actor_kind: "codex",
      related_import_id: importJobId,
      event_type: "codex_action",
    });
    expect(state.insertedEvents[0].payload).toMatchObject({
      codex: {
        action_type: "start_enrichment",
        idempotency_key: "start-once",
        reversible: false,
        validation: {
          import_scoped: true,
          actor_spoofing_blocked: true,
        },
      },
    });
  });

  it("accepts the Codex operator key without spoofing a human user", async () => {
    vi.stubEnv("SOCLE_CODEX_OPERATOR_KEY", "operator-secret");
    const state: MockState = { insertedEvents: [], updates: [], insertedRows: [] };
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(state));
    const { POST } = await import("../route");

    const res = await POST(
      makeRequest(
        { action_type: "start_enrichment", idempotency_key: "operator-key-start" },
        { "x-socle-codex-operator-key": "operator-secret", cookie: "" },
      ),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(state.insertedEvents[0]).toMatchObject({
      actor_kind: "codex",
      triggered_by: null,
    });
  });

  it("blocks AI-triggering actions when the budget check fails", async () => {
    const state: MockState = { insertedEvents: [], updates: [], insertedRows: [] };
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(state));
    assertBudgetCanSpendMock.mockReturnValue({ ok: false, error: "Session AI budget would be exceeded." });
    const { POST } = await import("../route");

    const res = await POST(makeRequest({
      action_type: "start_enrichment",
      idempotency_key: "budget-stop",
    }), makeCtx());
    const json = await readJson(res);

    expect(res.status).toBe(400);
    expect(json.error).toBe("Session AI budget would be exceeded.");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(state.insertedEvents).toHaveLength(1);
    expect(state.insertedEvents[0]).toMatchObject({
      actor_kind: "codex",
      status: "failed",
    });
  });

  it("rejects retry when the job belongs to another import and logs the failed action", async () => {
    const state: MockState = {
      insertedEvents: [],
      updates: [],
      insertedRows: [],
      jobs: [{ id: jobId, lead_id: leadId, contact_id: "contact-1", status: "failed", attempts: 0, max_attempts: 3 }],
    };
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(state));
    leadBelongsToImportMock.mockResolvedValue(false);
    const { POST } = await import("../route");

    const res = await POST(makeRequest({
      action_type: "retry_enrichment_job",
      payload: { jobId },
      idempotency_key: "retry-wrong-import",
    }), makeCtx());
    const json = await readJson(res);

    expect(res.status).toBe(400);
    expect(json.code).toBe("action_failed");
    expect(json.error).toContain("does not belong");
    expect(state.insertedEvents).toHaveLength(1);
    expect(state.insertedEvents[0]).toMatchObject({
      actor_kind: "codex",
      status: "failed",
      error_message: "Job does not belong to this import.",
    });
  });

  it("keeps trusted review application gated behind the auto-review flag", async () => {
    const state: MockState = {
      insertedEvents: [],
      updates: [],
      insertedRows: [],
      phoneCandidates: [{
        id: "44444444-4444-4444-8444-444444444444",
        lead_id: leadId,
        contact_id: "55555555-5555-4555-8555-555555555555",
        phone_e164: "+15145550123",
        phone_raw: "(514) 555-0123",
        source_label: "canada411",
        source_url: "https://example.test",
        snippet: "directory phone",
        matched_on: "mailing_address",
        source_class: "directory_authoritative",
        initial_confidence: 86,
        review_reason: "good",
        candidate_status: "needs_anthony_review",
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
      }],
    };
    createSupabaseAdminClientMock.mockReturnValue(makeSupabase(state));
    buildReviewProposalMock.mockReturnValue({
      candidateId: "44444444-4444-4444-8444-444444444444",
      verdict: "approve",
      reason: "trusted pattern",
    });
    const { POST } = await import("../route");

    const res = await POST(makeRequest({
      action_type: "apply_trusted_review_decisions",
      idempotency_key: "trusted-review-flag-off",
    }), makeCtx());
    const json = await readJson(res);

    expect(res.status).toBe(200);
    expect(json.data?.actionType).toBe("apply_trusted_review_decisions");
    expect(state.updates).toHaveLength(0);
    expect(state.insertedEvents[0].payload).toMatchObject({
      codex: {
        action_type: "apply_trusted_review_decisions",
        reversible: false,
        validation: {
          auto_review_enabled: false,
        },
      },
    });
  });
});
