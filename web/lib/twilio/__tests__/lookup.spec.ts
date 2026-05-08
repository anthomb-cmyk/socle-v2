import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupCallerName } from "../lookup";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type ChainMock = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

function makeChain(cacheResult: unknown): ChainMock {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    gt: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(cacheResult),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as ChainMock;

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.gt.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);

  return chain;
}

function makeSupabaseMock(cacheResult: unknown) {
  const chain = makeChain(cacheResult);
  const sb = {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
  };
  return sb;
}

// ---------------------------------------------------------------------------
// Env var helpers
// ---------------------------------------------------------------------------

function setTwilioEnv() {
  process.env.TWILIO_ACCOUNT_SID = "ACtest123";
  process.env.TWILIO_AUTH_TOKEN = "auth_token_test";
}

function clearTwilioEnv() {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lookupCallerName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTwilioEnv();
  });

  afterEach(() => {
    clearTwilioEnv();
  });

  // 1. Cache hit — returns cached data without calling Twilio
  it("returns cached result when a fresh row exists", async () => {
    setTwilioEnv();
    const cachedRow = {
      carrier_name: "Bell Canada",
      caller_type: "business",
      line_type: "landline",
    };
    const sb = makeSupabaseMock({ data: cachedRow, error: null });

    const result = await lookupCallerName(sb as never, "+15141234567");

    expect(result.cached).toBe(true);
    expect(result.caller_name).toBe("Bell Canada");
    expect(result.caller_type).toBe("business");
    expect(result.line_type).toBe("landline");
    expect(result.error).toBeUndefined();
    // from() should have been called for the cache SELECT only (not for insert)
    expect(sb.from).toHaveBeenCalledWith("twilio_lookup_log");
  });

  // 2. Cache miss — calls Twilio and inserts row
  it("on cache miss, calls Twilio API and inserts a cache row", async () => {
    setTwilioEnv();
    // maybeSingle returns null → cache miss
    const sb = makeSupabaseMock({ data: null, error: null });

    const twilioResponse = {
      caller_name: { caller_name: "Acme Corp", caller_type: "business" },
      line_type_intelligence: { type: "voip" },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => twilioResponse,
    } as Response);

    const result = await lookupCallerName(sb as never, "+15141234567");

    expect(result.cached).toBe(false);
    expect(result.caller_name).toBe("Acme Corp");
    expect(result.caller_type).toBe("business");
    expect(result.line_type).toBe("voip");
    expect(result.error).toBeUndefined();

    // insert should have been called
    expect(sb._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        phone_e164: "+15141234567",
        carrier_name: "Acme Corp",
        caller_type: "business",
        line_type: "voip",
        cost_usd: 0.04,
      }),
    );
  });

  // 3. Missing env vars — returns error object, does NOT throw
  it("returns error object when TWILIO env vars are missing", async () => {
    // env vars cleared in beforeEach
    const sb = makeSupabaseMock({ data: null, error: null });

    const result = await lookupCallerName(sb as never, "+15141234567");

    expect(result.error).toMatch(/TWILIO_ACCOUNT_SID \/ TWILIO_AUTH_TOKEN not set/);
    expect(result.caller_name).toBeNull();
    expect(result.cached).toBe(false);
    // Should NOT have called the cache or Twilio
    expect(sb.from).not.toHaveBeenCalled();
  });

  // 4. Expired cache row → cache lookup returns null → triggers refetch
  it("triggers a live Twilio call when only expired rows exist (maybeSingle returns null)", async () => {
    setTwilioEnv();
    // Simulate the cache query returning null (the gt(expires_at) filter excluded it)
    const sb = makeSupabaseMock({ data: null, error: null });

    const twilioResponse = {
      caller_name: { caller_name: "Rogers Inc", caller_type: "consumer" },
      line_type_intelligence: { type: "mobile" },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => twilioResponse,
    } as Response);

    const result = await lookupCallerName(sb as never, "+15149876543");

    expect(result.cached).toBe(false);
    expect(result.caller_name).toBe("Rogers Inc");
    expect(result.line_type).toBe("mobile");
    // gt() was called with "expires_at" to filter out expired rows
    expect(sb._chain.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    // A new insert was made
    expect(sb._chain.insert).toHaveBeenCalled();
  });

  // 5. E.164 normalization — 10-digit input is normalised to +1…
  it("normalises a 10-digit phone to E.164 before cache lookup", async () => {
    setTwilioEnv();
    const cachedRow = {
      carrier_name: "Videotron",
      caller_type: "business",
      line_type: "landline",
    };
    const sb = makeSupabaseMock({ data: cachedRow, error: null });

    // Pass a 10-digit number without +1
    const result = await lookupCallerName(sb as never, "5141234567");

    expect(result.cached).toBe(true);
    // The eq() should have been called with the normalised form
    expect(sb._chain.eq).toHaveBeenCalledWith("phone_e164", "+15141234567");
  });

  // 6. Twilio API error → returns error object, does NOT throw
  it("returns error object when Twilio API returns an HTTP error", async () => {
    setTwilioEnv();
    const sb = makeSupabaseMock({ data: null, error: null });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Phone number not found",
    } as Response);

    const result = await lookupCallerName(sb as never, "+15141234567");

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/Twilio lookup failed/);
    expect(result.cached).toBe(false);
    expect(result.caller_name).toBeNull();
  });

  // 7. Twilio response with null caller_name fields
  it("handles Twilio response where caller_name is absent", async () => {
    setTwilioEnv();
    const sb = makeSupabaseMock({ data: null, error: null });

    const twilioResponse = {
      // No caller_name, no line_type_intelligence
      phone_number: "+15141234567",
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => twilioResponse,
    } as Response);

    const result = await lookupCallerName(sb as never, "+15141234567");

    expect(result.caller_name).toBeNull();
    expect(result.caller_type).toBeNull();
    expect(result.line_type).toBeNull();
    expect(result.cached).toBe(false);
    expect(result.error).toBeUndefined();
  });
});
