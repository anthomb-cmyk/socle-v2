/**
 * runner.ts — Backtest harness runner.
 *
 * Runs a pipeline function over every lead in a Snapshot, enforcing shadow
 * mode (writes to forbidden tables throw), and computes a BacktestReport.
 */

import type {
  Snapshot,
  SnapshotLead,
  PipelineFn,
  PipelineResult,
  BacktestReport,
  BacktestOptions,
  PipelineBreakdown,
  ShadowSupabaseClient,
  ShadowQueryBuilder,
} from "./types";

/**
 * Tables that pipelines are FORBIDDEN from writing to in shadow mode.
 * Reads are allowed everywhere.
 */
const FORBIDDEN_WRITE_TABLES = new Set([
  "phones",
  "leads",
  "phone_candidates",
  "enrichment_events",
]);

/**
 * Creates a shadow Supabase client that blocks writes to forbidden tables.
 * The underlying real client (if provided) is used for reads; writes to
 * allowed tables are forwarded. In tests the real client can be omitted.
 */
export function createShadowClient(
  realClient?: { from: (table: string) => unknown }
): ShadowSupabaseClient {
  function makeBuilder(table: string): ShadowQueryBuilder {
    const isForbidden = FORBIDDEN_WRITE_TABLES.has(table);

    function forbiddenWrite(op: string): never {
      throw new Error(
        `Shadow mode violation: pipeline attempted ${op} on forbidden table "${table}". ` +
          `Forbidden tables: ${[...FORBIDDEN_WRITE_TABLES].join(", ")}.`
      );
    }

    // Proxy for a real builder when we have a real client
    const realBuilder = realClient ? (realClient.from(table) as Record<string, unknown>) : null;

    const builder: ShadowQueryBuilder = {
      select: (...args: unknown[]) => {
        if (realBuilder && typeof realBuilder["select"] === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rb = (realBuilder["select"] as (...a: any[]) => unknown)(...args);
          return wrapRealBuilder(table, rb as Record<string, unknown>);
        }
        return makeBuilder(table);
      },
      insert: async (_data: unknown) => {
        if (isForbidden) forbiddenWrite("insert");
        if (realBuilder && typeof realBuilder["insert"] === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (realBuilder["insert"] as (...a: any[]) => unknown)(_data) as Promise<{ data: unknown; error: null | { message: string } }>;
        }
        return { data: null, error: null };
      },
      upsert: async (_data: unknown) => {
        if (isForbidden) forbiddenWrite("upsert");
        if (realBuilder && typeof realBuilder["upsert"] === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (realBuilder["upsert"] as (...a: any[]) => unknown)(_data) as Promise<{ data: unknown; error: null | { message: string } }>;
        }
        return { data: null, error: null };
      },
      update: (_data: unknown) => {
        if (isForbidden) forbiddenWrite("update");
        return makeBuilder(table);
      },
      delete: () => {
        if (isForbidden) forbiddenWrite("delete");
        return makeBuilder(table);
      },
      eq: (_col: string, _val: unknown) => makeBuilder(table),
      in: (_col: string, _vals: unknown[]) => makeBuilder(table),
      limit: (_n: number) => makeBuilder(table),
      order: (_col: string, _opts?: unknown) => makeBuilder(table),
      single: async () => ({ data: null, error: null }),
      then: (resolve, reject) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };

    return builder;
  }

  function wrapRealBuilder(
    table: string,
    rb: Record<string, unknown>
  ): ShadowQueryBuilder {
    const isForbidden = FORBIDDEN_WRITE_TABLES.has(table);

    function forbiddenWrite(op: string): never {
      throw new Error(
        `Shadow mode violation: pipeline attempted ${op} on forbidden table "${table}".`
      );
    }

    const builder: ShadowQueryBuilder = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (...args: unknown[]) => wrapRealBuilder(table, (typeof rb["select"] === "function" ? (rb["select"] as (...a: any[]) => unknown)(...args) : rb) as Record<string, unknown>),
      insert: async (data: unknown) => {
        if (isForbidden) forbiddenWrite("insert");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (typeof rb["insert"] === "function" ? (rb["insert"] as (...a: any[]) => unknown)(data) : { data: null, error: null }) as Promise<{ data: unknown; error: null | { message: string } }>;
      },
      upsert: async (data: unknown) => {
        if (isForbidden) forbiddenWrite("upsert");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (typeof rb["upsert"] === "function" ? (rb["upsert"] as (...a: any[]) => unknown)(data) : { data: null, error: null }) as Promise<{ data: unknown; error: null | { message: string } }>;
      },
      update: (data: unknown) => {
        if (isForbidden) forbiddenWrite("update");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return wrapRealBuilder(table, (typeof rb["update"] === "function" ? (rb["update"] as (...a: any[]) => unknown)(data) : rb) as Record<string, unknown>);
      },
      delete: () => {
        if (isForbidden) forbiddenWrite("delete");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return wrapRealBuilder(table, (typeof rb["delete"] === "function" ? (rb["delete"] as (...a: any[]) => unknown)() : rb) as Record<string, unknown>);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eq: (col: string, val: unknown) => wrapRealBuilder(table, (typeof rb["eq"] === "function" ? (rb["eq"] as (...a: any[]) => unknown)(col, val) : rb) as Record<string, unknown>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      in: (col: string, vals: unknown[]) => wrapRealBuilder(table, (typeof rb["in"] === "function" ? (rb["in"] as (...a: any[]) => unknown)(col, vals) : rb) as Record<string, unknown>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      limit: (n: number) => wrapRealBuilder(table, (typeof rb["limit"] === "function" ? (rb["limit"] as (...a: any[]) => unknown)(n) : rb) as Record<string, unknown>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order: (col: string, opts?: unknown) => wrapRealBuilder(table, (typeof rb["order"] === "function" ? (rb["order"] as (...a: any[]) => unknown)(col, opts) : rb) as Record<string, unknown>),
      single: async () => {
        if (typeof rb["then"] === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await (rb as any);
          return r as { data: unknown; error: null | { message: string } };
        }
        return { data: null, error: null };
      },
      then: (resolve, reject) => {
        if (typeof rb["then"] === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (rb as any).then(resolve as any, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve as Parameters<typeof Promise.prototype.then>[0], reject);
      },
    };
    return builder;
  }

  return {
    from: (table: string) => makeBuilder(table),
  };
}

function emptyBreakdown(): PipelineBreakdown {
  return { evaluated: 0, released: 0, held: 0, unresolved: 0 };
}

function addToBreakdown(bd: PipelineBreakdown, result: PipelineResult) {
  bd.evaluated++;
  if (result.outcome === "released") bd.released++;
  else if (result.outcome === "held") bd.held++;
  else bd.unresolved++;
}

/**
 * Run a pipeline function over every lead in a snapshot.
 * Computes a BacktestReport with accuracy metrics.
 */
export async function runBacktest(
  snapshot: Snapshot,
  pipeline: PipelineFn,
  opts: BacktestOptions = {}
): Promise<BacktestReport> {
  const { includeDetails = false, concurrency = 1 } = opts;

  const shadowClient = createShadowClient();

  const byPipeline: BacktestReport["by_pipeline"] = {
    A: emptyBreakdown(),
    B: emptyBreakdown(),
    unspecified: emptyBreakdown(),
  };

  let released_count = 0;
  let held_count = 0;
  let unresolved_count = 0;
  let released_correct = 0;
  let released_wrong = 0;
  let released_unverifiable = 0;
  let held_correctly = 0;
  let held_when_should_release = 0;

  type DetailEntry = {
    lead_id: string;
    outcome: string;
    phone_e164?: string | null;
    tier?: string | null;
    by_pipeline?: string;
    snapshot_phone: string | null;
    correct: boolean | null;
  };
  const details: DetailEntry[] = [];

  async function processOne(lead: SnapshotLead): Promise<void> {
    const result = await pipeline(lead, shadowClient);

    const variant = result.by_pipeline ?? "unspecified";
    const bd =
      variant === "A"
        ? byPipeline.A
        : variant === "B"
          ? byPipeline.B
          : byPipeline.unspecified;
    addToBreakdown(bd, result);

    const snapshotPhone = lead.current_phone ?? null;

    if (result.outcome === "released") {
      released_count++;
      const releasedPhone = result.phone_e164 ?? null;
      if (snapshotPhone === null) {
        // We can't verify — snapshot had no phone
        released_unverifiable++;
      } else if (releasedPhone && releasedPhone === snapshotPhone) {
        released_correct++;
      } else {
        released_wrong++;
      }
    } else if (result.outcome === "held") {
      held_count++;
      if (snapshotPhone === null) {
        held_correctly++;
      } else {
        held_when_should_release++;
      }
    } else {
      unresolved_count++;
    }

    if (includeDetails) {
      const snapshotPh = lead.current_phone ?? null;
      let correct: boolean | null = null;
      if (result.outcome === "released") {
        if (snapshotPh !== null) {
          correct = result.phone_e164 === snapshotPh;
        }
      }
      details.push({
        lead_id: lead.lead_id,
        outcome: result.outcome,
        phone_e164: result.phone_e164 ?? null,
        tier: result.tier ?? null,
        by_pipeline: result.by_pipeline,
        snapshot_phone: snapshotPh,
        correct,
      });
    }
  }

  // Process with concurrency control
  const leads = snapshot.leads;
  if (concurrency <= 1) {
    for (const lead of leads) {
      await processOne(lead);
    }
  } else {
    // Chunked concurrency
    for (let i = 0; i < leads.length; i += concurrency) {
      const chunk = leads.slice(i, i + concurrency);
      await Promise.all(chunk.map(processOne));
    }
  }

  const denominator = released_correct + released_wrong;
  const precision = denominator > 0 ? released_correct / denominator : null;

  const report: BacktestReport = {
    run_at: new Date().toISOString(),
    leads_evaluated: leads.length,
    released_count,
    held_count,
    unresolved_count,
    released_correct,
    released_wrong,
    released_unverifiable,
    held_correctly,
    held_when_should_release,
    precision,
    by_pipeline: byPipeline,
  };

  if (includeDetails) {
    report.details = details as BacktestReport["details"];
  }

  return report;
}

/**
 * Renders a BacktestReport as a Markdown string for easy review.
 */
export function toMarkdown(report: BacktestReport): string {
  const pct = (n: number, d: number) =>
    d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;

  const lines: string[] = [
    "# Backtest Report",
    "",
    `**Run at:** ${report.run_at}`,
    `**Leads evaluated:** ${report.leads_evaluated}`,
    "",
    "## Outcomes",
    "",
    `| Outcome     | Count | % of Total |`,
    `|-------------|-------|------------|`,
    `| Released    | ${report.released_count} | ${pct(report.released_count, report.leads_evaluated)} |`,
    `| Held        | ${report.held_count} | ${pct(report.held_count, report.leads_evaluated)} |`,
    `| Unresolved  | ${report.unresolved_count} | ${pct(report.unresolved_count, report.leads_evaluated)} |`,
    "",
    "## Accuracy",
    "",
    `| Metric                        | Count |`,
    `|-------------------------------|-------|`,
    `| Released correct              | ${report.released_correct} |`,
    `| Released wrong                | ${report.released_wrong} |`,
    `| Released unverifiable         | ${report.released_unverifiable} |`,
    `| Held correctly                | ${report.held_correctly} |`,
    `| Held when should release      | ${report.held_when_should_release} |`,
    `| Precision                     | ${report.precision !== null ? `${(report.precision * 100).toFixed(1)}%` : "n/a"} |`,
    "",
    "## Pipeline Breakdown",
    "",
    `| Pipeline | Evaluated | Released | Held | Unresolved |`,
    `|----------|-----------|----------|------|------------|`,
    `| A        | ${report.by_pipeline.A.evaluated} | ${report.by_pipeline.A.released} | ${report.by_pipeline.A.held} | ${report.by_pipeline.A.unresolved} |`,
    `| B        | ${report.by_pipeline.B.evaluated} | ${report.by_pipeline.B.released} | ${report.by_pipeline.B.held} | ${report.by_pipeline.B.unresolved} |`,
    `| (none)   | ${report.by_pipeline.unspecified.evaluated} | ${report.by_pipeline.unspecified.released} | ${report.by_pipeline.unspecified.held} | ${report.by_pipeline.unspecified.unresolved} |`,
  ];

  return lines.join("\n");
}
