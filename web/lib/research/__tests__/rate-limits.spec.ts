/**
 * Tests for the daily rate-cap helper.  All Supabase calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkAndIncrementDailyCap,
  getTwilioDailyCap,
  getBraveDailyCap,
  DEFAULT_TWILIO_DAILY_CAP,
  DEFAULT_BRAVE_DAILY_CAP,
} from "../rate-limits";

function makeSb(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("checkAndIncrementDailyCap", () => {
  it("returns allowed=true when used <= max", async () => {
    const sb = makeSb({ data: 5, error: null });
    const r = await checkAndIncrementDailyCap(sb, "twilio_lookups", 200);
    expect(r).toEqual({ allowed: true, used: 5 });
    expect(sb.rpc).toHaveBeenCalledWith("increment_api_daily_usage", {
      p_key: "twilio_lookups",
    });
  });

  it("returns allowed=true at exactly the cap", async () => {
    const sb = makeSb({ data: 200, error: null });
    const r = await checkAndIncrementDailyCap(sb, "twilio_lookups", 200);
    expect(r).toEqual({ allowed: true, used: 200 });
  });

  it("blocks when used > max", async () => {
    const sb = makeSb({ data: 201, error: null });
    const r = await checkAndIncrementDailyCap(sb, "twilio_lookups", 200);
    expect(r).toEqual({ allowed: false, used: 201 });
  });

  it("fails open when RPC errors", async () => {
    const sb = makeSb({ data: null, error: { message: "boom" } });
    const r = await checkAndIncrementDailyCap(sb, "brave_queries", 1000);
    expect(r).toEqual({ allowed: true, used: 0 });
  });

  it("fails open when RPC throws", async () => {
    const sb = {
      rpc: vi.fn().mockRejectedValue(new Error("network")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await checkAndIncrementDailyCap(sb, "brave_queries", 1000);
    expect(r).toEqual({ allowed: true, used: 0 });
  });
});

describe("env-driven caps", () => {
  const origTwilio = process.env.MAX_TWILIO_LOOKUPS_PER_DAY;
  const origBrave = process.env.MAX_BRAVE_QUERIES_PER_DAY;

  beforeEach(() => {
    delete process.env.MAX_TWILIO_LOOKUPS_PER_DAY;
    delete process.env.MAX_BRAVE_QUERIES_PER_DAY;
  });

  afterEach(() => {
    if (origTwilio !== undefined) process.env.MAX_TWILIO_LOOKUPS_PER_DAY = origTwilio;
    if (origBrave !== undefined) process.env.MAX_BRAVE_QUERIES_PER_DAY = origBrave;
  });

  it("falls back to defaults when env unset", () => {
    expect(getTwilioDailyCap()).toBe(DEFAULT_TWILIO_DAILY_CAP);
    expect(getBraveDailyCap()).toBe(DEFAULT_BRAVE_DAILY_CAP);
  });

  it("respects env override for Twilio", () => {
    process.env.MAX_TWILIO_LOOKUPS_PER_DAY = "42";
    expect(getTwilioDailyCap()).toBe(42);
  });

  it("respects env override for Brave", () => {
    process.env.MAX_BRAVE_QUERIES_PER_DAY = "777";
    expect(getBraveDailyCap()).toBe(777);
  });

  it("ignores non-numeric env values", () => {
    process.env.MAX_TWILIO_LOOKUPS_PER_DAY = "not-a-number";
    expect(getTwilioDailyCap()).toBe(DEFAULT_TWILIO_DAILY_CAP);
  });

  it("ignores zero or negative env values", () => {
    process.env.MAX_BRAVE_QUERIES_PER_DAY = "0";
    expect(getBraveDailyCap()).toBe(DEFAULT_BRAVE_DAILY_CAP);
    process.env.MAX_BRAVE_QUERIES_PER_DAY = "-5";
    expect(getBraveDailyCap()).toBe(DEFAULT_BRAVE_DAILY_CAP);
  });
});
