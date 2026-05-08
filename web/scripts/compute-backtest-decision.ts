/**
 * compute-backtest-decision.ts — Phase 10 decision computation.
 *
 * Reads a backtest report JSON sidecar (produced by run-backtest.ts) and
 * computes a PROCEED / HALT decision per the locked thresholds:
 *
 *   PROCEED when:
 *     new_wrong_rate  <= old_wrong_rate          (quality gate)
 *     AND abs(new_found_rate - old_found_rate) <= 5pp  (coverage gate)
 *
 * Usage (from web/ dir):
 *   npx tsx scripts/compute-backtest-decision.ts \
 *     --report  data/backtest_report_v1.json \
 *     [--labels data/spot_check_labels.json]   (optional; not required)
 *     [--output data/backtest_decision_v1.md]
 *
 * Labels file format (optional):
 *   { "labels": [ { "lead_id": "...", "phone_correct": true|false } ] }
 *   Labels override the automatic correctness judgement from the snapshot
 *   phone for the listed leads.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  reportPath: string;
  labelsPath: string | null;
  outputPath: string;
} {
  const args = argv.slice(2);
  let reportPath = join(__dirname, "../data/backtest_report_v1.json");
  let labelsPath: string | null = null;
  let outputPath = join(__dirname, "../data/backtest_decision_v1.md");

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--report" && args[i + 1]) {
      reportPath = args[++i];
      // Support .md path: convert to .json sidecar
      if (reportPath.endsWith(".md")) {
        reportPath = reportPath.replace(/\.md$/, ".json");
      }
    } else if (arg === "--labels" && args[i + 1]) {
      labelsPath = args[++i];
    } else if (arg === "--output" && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  return { reportPath, labelsPath, outputPath };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BacktestReportJson {
  run_at: string;
  leads_evaluated: number;
  released_count: number;
  held_count: number;
  unresolved_count: number;
  released_correct: number;
  released_wrong: number;
  released_unverifiable: number;
  held_correctly: number;
  held_when_should_release: number;
  precision: number | null;
  smoke_test?: boolean;
  dry_run?: boolean;
  by_pipeline: {
    A: { evaluated: number; released: number; held: number; unresolved: number };
    B: { evaluated: number; released: number; held: number; unresolved: number };
    unspecified: { evaluated: number; released: number; held: number; unresolved: number };
  };
  details?: Array<{
    lead_id: string;
    outcome: string;
    phone_e164?: string | null;
    tier?: string | null;
    by_pipeline?: string;
    snapshot_phone: string | null;
    correct: boolean | null;
  }>;
}

interface SpotCheckLabel {
  lead_id: string;
  phone_correct: boolean;
}

interface LabelsFile {
  labels: SpotCheckLabel[];
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function absDiff(a: number, b: number): number {
  return Math.abs(a - b);
}

/**
 * Compute the "old system" baseline stats.
 *
 * The old system is the existing CRM phone data in the snapshot.
 * - old_found_rate = leads with a non-null current_phone / total leads
 * - old_wrong_rate = leads labelled wrong / (released_correct + released_wrong)
 *   When no labels exist, old_wrong_rate = 0 (we assume CRM truth is correct).
 *
 * Note: for the snapshot, "found" means `current_phone !== null`.
 * We don't have a "released_count" concept for the old system — it either
 * has a phone or it doesn't.
 */
interface OldStats {
  total_leads: number;
  leads_with_phone: number;
  found_rate: number;
  wrong_rate: number; // always 0 until labels prove otherwise
}

function computeOldStats(
  report: BacktestReportJson,
  _labels: SpotCheckLabel[],
): OldStats {
  // The snapshot's found count = leads that had a phone (released_correct +
  // released_wrong + held_when_should_release + released_unverifiable).
  // But we don't store snapshot phones directly in the JSON report.
  //
  // Approximation from report fields:
  //   leads with snapshot phone = released_correct + released_wrong + held_when_should_release
  //   (released_unverifiable = pipeline found phone but snapshot had none, so those are "no phone" in old system)
  const leadsWithPhone =
    report.released_correct +
    report.released_wrong +
    report.held_when_should_release;

  const total = report.leads_evaluated;
  const foundRate = total > 0 ? leadsWithPhone / total : 0;

  // Old wrong rate: 0 (CRM is assumed correct; labels can override in future)
  const wrongRate = 0;

  return {
    total_leads: total,
    leads_with_phone: leadsWithPhone,
    found_rate: foundRate,
    wrong_rate: wrongRate,
  };
}

/**
 * Compute "new system" stats.
 *
 * - new_found_rate = released_count / leads_evaluated
 * - new_wrong_rate = released_wrong / (released_correct + released_wrong)
 *   (or 0 if no verifiable releases)
 */
interface NewStats {
  found_rate: number;
  wrong_rate: number;
  released_count: number;
  released_correct: number;
  released_wrong: number;
  released_unverifiable: number;
}

function computeNewStats(
  report: BacktestReportJson,
  labels: SpotCheckLabel[],
): NewStats {
  let releasedCorrect = report.released_correct;
  let releasedWrong = report.released_wrong;

  // Apply any spot-check label overrides
  const labelMap = new Map<string, boolean>(
    labels.map((l) => [l.lead_id, l.phone_correct]),
  );

  if (labelMap.size > 0 && report.details) {
    // Reset label-affected leads
    for (const detail of report.details) {
      if (detail.outcome !== "released") continue;
      const labelled = labelMap.get(detail.lead_id);
      if (labelled === undefined) continue;

      // The original computation may have already counted this lead; we need
      // to adjust. Since we can't easily un-count without knowing the original
      // classification, we recompute only the labelled leads.
      const snapshotPhone = detail.snapshot_phone;
      if (snapshotPhone !== null) {
        // Was already classified as correct or wrong
        const wasCorrect = detail.correct === true;
        if (wasCorrect && !labelled) {
          releasedCorrect--;
          releasedWrong++;
        } else if (!wasCorrect && labelled) {
          releasedCorrect++;
          releasedWrong--;
        }
      }
    }
  }

  const verifiable = releasedCorrect + releasedWrong;
  const wrongRate = verifiable > 0 ? releasedWrong / verifiable : 0;
  const foundRate =
    report.leads_evaluated > 0
      ? report.released_count / report.leads_evaluated
      : 0;

  return {
    found_rate: foundRate,
    wrong_rate: wrongRate,
    released_count: report.released_count,
    released_correct: releasedCorrect,
    released_wrong: releasedWrong,
    released_unverifiable: report.released_unverifiable,
  };
}

// ---------------------------------------------------------------------------
// Disagreement list (top 20 spot-check candidates)
// ---------------------------------------------------------------------------

function findDisagreements(
  report: BacktestReportJson,
): Array<{
  lead_id: string;
  snapshot_phone: string | null;
  new_phone: string | null;
  outcome: string;
  pipeline: string;
}> {
  if (!report.details) return [];

  const disagreements: Array<{
    lead_id: string;
    snapshot_phone: string | null;
    new_phone: string | null;
    outcome: string;
    pipeline: string;
  }> = [];

  for (const d of report.details) {
    const isDisagreement =
      // Pipeline released but old system had a different phone
      (d.outcome === "released" && d.snapshot_phone !== null && d.correct === false) ||
      // Pipeline held/unresolved but old system had a phone
      (d.outcome !== "released" && d.snapshot_phone !== null) ||
      // Pipeline released but old system had no phone (unverifiable — worth checking)
      (d.outcome === "released" && d.snapshot_phone === null);

    if (isDisagreement) {
      disagreements.push({
        lead_id: d.lead_id,
        snapshot_phone: d.snapshot_phone ?? null,
        new_phone: d.phone_e164 ?? null,
        outcome: d.outcome,
        pipeline: d.by_pipeline ?? "?",
      });
    }
  }

  return disagreements.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Markdown report renderer
// ---------------------------------------------------------------------------

function renderDecisionReport(params: {
  report: BacktestReportJson;
  oldStats: OldStats;
  newStats: NewStats;
  decision: "PROCEED" | "HALT" | "NOT_RUN";
  decisionReason: string;
  disagreements: ReturnType<typeof findDisagreements>;
}): string {
  const { report, oldStats, newStats, decision, decisionReason, disagreements } = params;

  const foundDiff = absDiff(newStats.found_rate, oldStats.found_rate);
  const wrongGate =
    newStats.wrong_rate <= oldStats.wrong_rate
      ? "PASS"
      : "FAIL";
  const foundGate = foundDiff <= 0.05 ? "PASS" : "FAIL";

  const lines: string[] = [
    "# Backtest Decision Report",
    "",
    `**Generated at:** ${new Date().toISOString()}`,
    `**Backtest run at:** ${report.run_at}`,
    `**Mode:** ${report.smoke_test ? "smoke-test (REQ-only)" : "full"} / ${report.dry_run ? "dry-run" : "persist"}`,
    "",
    `## Decision: ${decision}`,
    "",
    `> ${decisionReason}`,
    "",
    "## Metrics",
    "",
    "### Old System (CRM baseline)",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total leads | ${oldStats.total_leads} |`,
    `| Leads with phone | ${oldStats.leads_with_phone} |`,
    `| Found rate | ${pct(oldStats.leads_with_phone, oldStats.total_leads)} |`,
    `| Wrong rate | ${pct(oldStats.wrong_rate * oldStats.leads_with_phone, oldStats.leads_with_phone)} (assumed 0 — CRM is ground truth) |`,
    "",
    "### New System (pipeline results)",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Leads evaluated | ${report.leads_evaluated} |`,
    `| Released (phone found) | ${newStats.released_count} |`,
    `| Held (candidate only) | ${report.held_count} |`,
    `| Unresolved | ${report.unresolved_count} |`,
    `| Released correct | ${newStats.released_correct} |`,
    `| Released wrong | ${newStats.released_wrong} |`,
    `| Released unverifiable | ${newStats.released_unverifiable} |`,
    `| Found rate | ${pct(newStats.released_count, report.leads_evaluated)} |`,
    `| Wrong rate | ${newStats.released_correct + newStats.released_wrong > 0 ? pct(newStats.released_wrong, newStats.released_correct + newStats.released_wrong) : "n/a (no verifiable releases)"} |`,
    "",
    "## Gate Checks",
    "",
    `| Gate | Threshold | New | Old | Result |`,
    `|------|-----------|-----|-----|--------|`,
    `| Wrong rate | new ≤ old | ${(newStats.wrong_rate * 100).toFixed(1)}% | ${(oldStats.wrong_rate * 100).toFixed(1)}% | ${wrongGate} |`,
    `| Found rate delta | |new − old| ≤ 5pp | ${(newStats.found_rate * 100).toFixed(1)}% | ${(oldStats.found_rate * 100).toFixed(1)}% (diff: ${(foundDiff * 100).toFixed(1)}pp) | ${foundGate} |`,
    "",
    "## Pipeline Breakdown",
    "",
    `| Pipeline | Evaluated | Released | Held | Unresolved |`,
    `|----------|-----------|----------|------|------------|`,
    `| A        | ${report.by_pipeline.A.evaluated} | ${report.by_pipeline.A.released} | ${report.by_pipeline.A.held} | ${report.by_pipeline.A.unresolved} |`,
    `| B        | ${report.by_pipeline.B.evaluated} | ${report.by_pipeline.B.released} | ${report.by_pipeline.B.held} | ${report.by_pipeline.B.unresolved} |`,
    `| (none)   | ${report.by_pipeline.unspecified.evaluated} | ${report.by_pipeline.unspecified.released} | ${report.by_pipeline.unspecified.held} | ${report.by_pipeline.unspecified.unresolved} |`,
    "",
  ];

  if (disagreements.length > 0) {
    lines.push(
      "## Top Disagreements (Spot-Check Candidates)",
      "",
      "Leads where new and old pipeline do not agree (up to 20):",
      "",
      `| Lead ID | Snapshot Phone | New Phone | Outcome | Pipeline |`,
      `|---------|----------------|-----------|---------|----------|`,
    );
    for (const d of disagreements) {
      lines.push(
        `| ${d.lead_id} | ${d.snapshot_phone ?? "(none)"} | ${d.new_phone ?? "(none)"} | ${d.outcome} | ${d.pipeline} |`,
      );
    }
    lines.push("");
  } else {
    lines.push("## Disagreements", "", "No per-lead details available (dry-run mode or details not collected).", "");
  }

  lines.push(
    "## Notes",
    "",
    "- Wrong rate for old system is assumed 0 (CRM data treated as ground truth).",
    "- In smoke-test mode, Brave-powered researchers (company-website, pages-jaunes-business,",
    "  reverse-address, name-postal-directory) and Twilio lookups are skipped.",
    "- Only req-phone (Pipeline A) and cross-property (Pipeline B) are active.",
    "- Most leads will appear as 'unresolved' if their canonical_owner was not found",
    "  (Phase 3 backfill may not cover all contacts in this sandbox environment).",
    "- Rerun with `--persist` to write evidence/hypothesis rows to DB.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { reportPath, labelsPath, outputPath } = parseArgs(process.argv);

  console.log("[compute-decision] Loading backtest report...");
  console.log(`  Report: ${reportPath}`);
  console.log(`  Labels: ${labelsPath ?? "(none)"}`);
  console.log(`  Output: ${outputPath}`);

  if (!existsSync(reportPath)) {
    const mdPath = reportPath.replace(/\.json$/, ".md");
    if (existsSync(mdPath)) {
      console.error(
        `[compute-decision] Report JSON not found at ${reportPath}.`,
      );
      console.error(
        `  Found .md report at ${mdPath} but cannot parse it.`,
      );
      console.error(
        "  Please pass --report pointing to the .json sidecar (generated by run-backtest.ts).",
      );
    } else {
      console.error(`[compute-decision] Report not found: ${reportPath}`);
    }
    process.exit(1);
  }

  let report: BacktestReportJson;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf-8")) as BacktestReportJson;
  } catch (err) {
    console.error("[compute-decision] Failed to parse report:", err);
    process.exit(1);
  }

  // Load labels (optional)
  let labels: SpotCheckLabel[] = [];
  if (labelsPath && existsSync(labelsPath)) {
    try {
      const raw = JSON.parse(readFileSync(labelsPath, "utf-8")) as LabelsFile;
      labels = raw.labels ?? [];
      console.log(`[compute-decision] Loaded ${labels.length} labels.`);
    } catch (err) {
      console.warn("[compute-decision] Failed to parse labels file (ignoring):", err);
    }
  }

  // Compute stats
  const oldStats = computeOldStats(report, labels);
  const newStats = computeNewStats(report, labels);

  // Apply decision thresholds
  const wrongGatePass = newStats.wrong_rate <= oldStats.wrong_rate;
  const foundDiff = absDiff(newStats.found_rate, oldStats.found_rate);
  const foundGatePass = foundDiff <= 0.05;

  let decision: "PROCEED" | "HALT" | "NOT_RUN";
  let decisionReason: string;

  // Special case: if the run was a stub/placeholder (0 leads evaluated from
  // a real pipeline run), mark as NOT_RUN.
  if (report.leads_evaluated === 0) {
    decision = "NOT_RUN";
    decisionReason = "No leads were evaluated. Backtest did not produce usable data.";
  } else if (wrongGatePass && foundGatePass) {
    decision = "PROCEED";
    decisionReason =
      `Both gates pass: ` +
      `wrong_rate ${(newStats.wrong_rate * 100).toFixed(1)}% ≤ ${(oldStats.wrong_rate * 100).toFixed(1)}% (old), ` +
      `found_rate delta ${(foundDiff * 100).toFixed(1)}pp ≤ 5pp.`;
  } else {
    decision = "HALT";
    const reasons: string[] = [];
    if (!wrongGatePass) {
      reasons.push(
        `wrong_rate gate FAIL: new ${(newStats.wrong_rate * 100).toFixed(1)}% > old ${(oldStats.wrong_rate * 100).toFixed(1)}%`,
      );
    }
    if (!foundGatePass) {
      reasons.push(
        `found_rate gate FAIL: delta ${(foundDiff * 100).toFixed(1)}pp > 5pp allowed`,
      );
    }
    decisionReason = reasons.join("; ");
  }

  // Build disagreement list
  const disagreements = findDisagreements(report);

  // Render and write output
  const md = renderDecisionReport({
    report,
    oldStats,
    newStats,
    decision,
    decisionReason,
    disagreements,
  });

  writeFileSync(outputPath, md, "utf-8");

  console.log(`\n[compute-decision] Decision: ${decision}`);
  console.log(`[compute-decision] Reason:   ${decisionReason}`);
  console.log(`[compute-decision] Written to: ${outputPath}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[compute-decision] Fatal error:", err);
  process.exit(1);
});
