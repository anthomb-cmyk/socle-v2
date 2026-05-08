import { describe, it, expect } from "vitest";
import { runBacktest, createShadowClient, toMarkdown } from "../runner";
import type { Snapshot, SnapshotLead, PipelineFn, BacktestReport } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshotLead(overrides: Partial<SnapshotLead> = {}): SnapshotLead {
  return {
    lead_id: "lead-1",
    contact_id: "contact-1",
    status: "needs_phone_review",
    lead_source: "role_import",
    owner_full_name: "Test Owner",
    company_name: null,
    mailing_address: "123 Main St",
    mailing_city: "Granby",
    mailing_province: "QC",
    mailing_postal: "J2G 1A1",
    mailing_country: "Canada",
    property_address: "123 Main St",
    property_city: "Granby",
    property_province: "QC",
    property_postal: null,
    num_units: 4,
    property_type: null,
    evaluation_total: null,
    current_phone: null,
    phone_status: null,
    phone_source: null,
    phone_confidence: null,
    candidate_count: 2,
    source_file_name: "Granby-10.xlsx",
    ...overrides,
  };
}

function makeSnapshot(leads: SnapshotLead[]): Snapshot {
  return {
    generated_at: "2026-01-01T00:00:00.000Z",
    count: leads.length,
    leads,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Basic deterministic output — same inputs yield same report
// ---------------------------------------------------------------------------
describe("runBacktest", () => {
  it("produces deterministic output for the same inputs", async () => {
    const snapshot = makeSnapshot([
      makeSnapshotLead({ lead_id: "l1", current_phone: null }),
      makeSnapshotLead({ lead_id: "l2", current_phone: "+15141234567" }),
    ]);

    const pipeline: PipelineFn = async (lead, _sb) => {
      if (lead.lead_id === "l1") return { outcome: "held" };
      return { outcome: "released", phone_e164: "+15141234567" };
    };

    const report1 = await runBacktest(snapshot, pipeline);
    const report2 = await runBacktest(snapshot, pipeline);

    // Numeric fields should be identical
    expect(report1.leads_evaluated).toBe(report2.leads_evaluated);
    expect(report1.released_count).toBe(report2.released_count);
    expect(report1.held_count).toBe(report2.held_count);
    expect(report1.released_correct).toBe(report2.released_correct);
    expect(report1.held_correctly).toBe(report2.held_correctly);
    expect(report1.precision).toBe(report2.precision);
  });

  // -------------------------------------------------------------------------
  // Test 2: Evaluates all leads in snapshot
  // -------------------------------------------------------------------------
  it("evaluates all leads in the snapshot", async () => {
    const leads = Array.from({ length: 10 }, (_, i) =>
      makeSnapshotLead({ lead_id: `lead-${i}` })
    );
    const snapshot = makeSnapshot(leads);

    const pipeline: PipelineFn = async () => ({ outcome: "held" });
    const report = await runBacktest(snapshot, pipeline);

    expect(report.leads_evaluated).toBe(10);
  });

  // -------------------------------------------------------------------------
  // Test 3: Refuses pipelines that write to phones table
  // -------------------------------------------------------------------------
  it("throws when pipeline tries to insert into phones table", async () => {
    const snapshot = makeSnapshot([makeSnapshotLead()]);

    const pipeline: PipelineFn = async (_lead, sb) => {
      await sb.from("phones").insert({ e164: "+15551234567" });
      return { outcome: "released", phone_e164: "+15551234567" };
    };

    await expect(runBacktest(snapshot, pipeline)).rejects.toThrow(
      /Shadow mode violation.*phones/
    );
  });

  // -------------------------------------------------------------------------
  // Test 4: Refuses pipelines that write to leads table
  // -------------------------------------------------------------------------
  it("throws when pipeline tries to update the leads table", async () => {
    const snapshot = makeSnapshot([makeSnapshotLead()]);

    const pipeline: PipelineFn = async (_lead, sb) => {
      // update is also forbidden on leads
      sb.from("leads").update({ status: "ready_to_call" });
      return { outcome: "held" };
    };

    await expect(runBacktest(snapshot, pipeline)).rejects.toThrow(
      /Shadow mode violation.*leads/
    );
  });

  // -------------------------------------------------------------------------
  // Test 5: Refuses pipelines that write to phone_candidates
  // -------------------------------------------------------------------------
  it("throws when pipeline tries to upsert into phone_candidates", async () => {
    const snapshot = makeSnapshot([makeSnapshotLead()]);

    const pipeline: PipelineFn = async (_lead, sb) => {
      await sb.from("phone_candidates").upsert({ lead_id: "x", phone_e164: "+1" });
      return { outcome: "held" };
    };

    await expect(runBacktest(snapshot, pipeline)).rejects.toThrow(
      /Shadow mode violation.*phone_candidates/
    );
  });

  // -------------------------------------------------------------------------
  // Test 6: Correct counting of released_correct vs released_wrong
  // -------------------------------------------------------------------------
  it("correctly counts released_correct and released_wrong", async () => {
    const snapshot = makeSnapshot([
      makeSnapshotLead({ lead_id: "l1", current_phone: "+15141111111" }),
      makeSnapshotLead({ lead_id: "l2", current_phone: "+15142222222" }),
      makeSnapshotLead({ lead_id: "l3", current_phone: "+15143333333" }),
    ]);

    const pipeline: PipelineFn = async (lead, _sb) => {
      if (lead.lead_id === "l1") {
        // correct — matches snapshot
        return { outcome: "released", phone_e164: "+15141111111" };
      }
      if (lead.lead_id === "l2") {
        // wrong — different number
        return { outcome: "released", phone_e164: "+15149999999" };
      }
      // l3: held even though snapshot has phone
      return { outcome: "held" };
    };

    const report = await runBacktest(snapshot, pipeline);

    expect(report.released_correct).toBe(1);
    expect(report.released_wrong).toBe(1);
    expect(report.held_when_should_release).toBe(1);
    expect(report.precision).toBeCloseTo(0.5);
  });

  // -------------------------------------------------------------------------
  // Test 7: held_correctly when snapshot has no phone
  // -------------------------------------------------------------------------
  it("counts held_correctly when snapshot lead has no phone", async () => {
    const snapshot = makeSnapshot([
      makeSnapshotLead({ lead_id: "l1", current_phone: null }),
      makeSnapshotLead({ lead_id: "l2", current_phone: null }),
      makeSnapshotLead({ lead_id: "l3", current_phone: "+15141111111" }),
    ]);

    const pipeline: PipelineFn = async () => ({ outcome: "held" });
    const report = await runBacktest(snapshot, pipeline);

    expect(report.held_correctly).toBe(2); // l1, l2
    expect(report.held_when_should_release).toBe(1); // l3
    expect(report.held_count).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test 8: Pipeline A/B breakdown
  // -------------------------------------------------------------------------
  it("correctly breaks down counts by pipeline A and B", async () => {
    const snapshot = makeSnapshot([
      makeSnapshotLead({ lead_id: "l1" }),
      makeSnapshotLead({ lead_id: "l2" }),
      makeSnapshotLead({ lead_id: "l3" }),
      makeSnapshotLead({ lead_id: "l4" }),
    ]);

    const pipeline: PipelineFn = async (lead, _sb) => {
      if (lead.lead_id === "l1") return { outcome: "released", by_pipeline: "A" };
      if (lead.lead_id === "l2") return { outcome: "held", by_pipeline: "A" };
      if (lead.lead_id === "l3") return { outcome: "released", by_pipeline: "B" };
      return { outcome: "held", by_pipeline: "B" };
    };

    const report = await runBacktest(snapshot, pipeline);

    expect(report.by_pipeline.A.evaluated).toBe(2);
    expect(report.by_pipeline.A.released).toBe(1);
    expect(report.by_pipeline.A.held).toBe(1);
    expect(report.by_pipeline.B.evaluated).toBe(2);
    expect(report.by_pipeline.B.released).toBe(1);
    expect(report.by_pipeline.B.held).toBe(1);
    expect(report.by_pipeline.unspecified.evaluated).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 9: released_unverifiable when snapshot has no phone
  // -------------------------------------------------------------------------
  it("counts released_unverifiable when snapshot has no existing phone", async () => {
    const snapshot = makeSnapshot([
      makeSnapshotLead({ lead_id: "l1", current_phone: null }),
    ]);

    const pipeline: PipelineFn = async () => ({
      outcome: "released",
      phone_e164: "+15140000000",
    });

    const report = await runBacktest(snapshot, pipeline);
    expect(report.released_unverifiable).toBe(1);
    expect(report.released_correct).toBe(0);
    expect(report.released_wrong).toBe(0);
    // precision is null because denominator is 0 (no verifiable releases)
    expect(report.precision).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 10: toMarkdown produces a non-empty string with expected headers
  // -------------------------------------------------------------------------
  it("toMarkdown returns a markdown string with expected sections", async () => {
    const snapshot = makeSnapshot([makeSnapshotLead()]);
    const pipeline: PipelineFn = async () => ({ outcome: "held" });
    const report = await runBacktest(snapshot, pipeline);
    const md = toMarkdown(report);

    expect(typeof md).toBe("string");
    expect(md).toContain("# Backtest Report");
    expect(md).toContain("## Outcomes");
    expect(md).toContain("## Accuracy");
    expect(md).toContain("## Pipeline Breakdown");
    expect(md.length).toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // Test 11: createShadowClient allows reads (from + select)
  // -------------------------------------------------------------------------
  it("shadow client allows calling from() and select() without throwing", () => {
    const sb = createShadowClient();
    // Should not throw
    expect(() => sb.from("phones").select("*")).not.toThrow();
    expect(() => sb.from("leads").select("id")).not.toThrow();
    // Allowed write tables should not throw on insert
    expect(() => sb.from("evidence").insert({ foo: "bar" })).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Test 12: includeDetails option populates details array
  // -------------------------------------------------------------------------
  it("includeDetails option attaches per-lead details to report", async () => {
    const snapshot = makeSnapshot([
      makeSnapshotLead({ lead_id: "detail-lead", current_phone: "+15140001111" }),
    ]);

    const pipeline: PipelineFn = async () => ({
      outcome: "released",
      phone_e164: "+15140001111",
      by_pipeline: "A",
    });

    const report = await runBacktest(snapshot, pipeline, { includeDetails: true });

    expect(report.details).toBeDefined();
    expect(report.details!.length).toBe(1);
    expect(report.details![0].lead_id).toBe("detail-lead");
    expect(report.details![0].outcome).toBe("released");
    expect(report.details![0].correct).toBe(true);
  });
});
