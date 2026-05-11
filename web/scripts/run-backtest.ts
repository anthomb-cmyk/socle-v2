/**
 * run-backtest.ts — Phase 10 backtest entry script.
 *
 * Runs the new research pipeline against every lead in the ground-truth
 * snapshot and emits a BacktestReport in Markdown format.
 *
 * Usage (from web/ dir):
 *   npx tsx scripts/run-backtest.ts \
 *     [--snapshot web/data/ground_truth_v0.json] \
 *     [--pipeline new] \
 *     [--output web/data/backtest_report_v1.md] \
 *     [--smoke-test]    # skip Brave + Twilio researchers
 *     [--persist]       # allow DB writes (evidence/hypothesis tables)
 *                       # default: --dry-run (no DB writes at all)
 *
 * Dry-run mode (default):
 *   Uses a stricter shadow client that blocks ALL writes.
 *   Evidence/hypothesis rows are NOT persisted; results are in-memory only.
 *
 * Persist mode (--persist flag):
 *   Writes to evidence/hypothesis tables are allowed (per Phase 0 contract).
 *   Writes to phones/leads/phone_candidates/enrichment_events still blocked.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import type { SnapshotLead, PipelineResult, ShadowSupabaseClient } from "../lib/backtest/types";
import type { Snapshot } from "../lib/backtest/types";
import { runBacktest, toMarkdown, createShadowClient } from "../lib/backtest/runner";
import { runPipelineA } from "../lib/research/pipeline-a";
import { runPipelineB } from "../lib/research/pipeline-b";
import { routeOwner } from "../lib/research/classifier";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  snapshotPath: string;
  outputPath: string;
  smokeTest: boolean;
  persist: boolean;
} {
  const args = argv.slice(2);
  let snapshotPath = join(__dirname, "../data/ground_truth_v0.json");
  let outputPath = join(__dirname, "../data/backtest_report_v1.md");
  let smokeTest = false;
  let persist = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--snapshot" && args[i + 1]) {
      snapshotPath = args[++i];
    } else if (arg === "--output" && args[i + 1]) {
      outputPath = args[++i];
    } else if (arg === "--pipeline") {
      i++; // consume the value (only "new" is valid, ignore)
    } else if (arg === "--smoke-test") {
      smokeTest = true;
    } else if (arg === "--persist") {
      persist = true;
    } else if (arg === "--dry-run") {
      persist = false; // explicit dry-run is same as default
    }
  }

  return { snapshotPath, outputPath, smokeTest, persist };
}

// ---------------------------------------------------------------------------
// Dry-run shadow client: blocks ALL writes (not just forbidden tables)
// ---------------------------------------------------------------------------

function createDryRunClient(): ShadowSupabaseClient {
  // Reuse the shadow client mechanism but override to block everything.
  // We wrap the regular shadow client approach: reads use the real DB
  // (if env vars are available); writes are silently no-ops.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  // If we have real DB creds, use them for reads only
  const realClient =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey)
      : undefined;

  return createDryRunShadowClient(realClient);
}

type RealClientLike = { from: (table: string) => unknown };

function createDryRunShadowClient(
  realClient?: RealClientLike,
): ShadowSupabaseClient {
  // Returns a client where all writes are no-ops but reads go to the real DB.
  function makeBuilder(table: string): import("../lib/backtest/types").ShadowQueryBuilder {
    const realBuilder = realClient
      ? (realClient.from(table) as Record<string, unknown>)
      : null;

    type QB = import("../lib/backtest/types").ShadowQueryBuilder;

    const chain = (rb?: Record<string, unknown> | null): QB => {
      const b: QB = {
        select: (...args: unknown[]) => {
          if (rb && typeof rb["select"] === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return chain((rb["select"] as (...a: any[]) => unknown)(...args) as Record<string, unknown>);
          }
          return chain(rb);
        },
        insert: async () => ({ data: null, error: null }),
        update: () => chain(rb),
        upsert: async () => ({ data: null, error: null }),
        delete: () => chain(rb),
        eq: (col: string, val: unknown) => {
          if (rb && typeof rb["eq"] === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return chain((rb["eq"] as (...a: any[]) => unknown)(col, val) as Record<string, unknown>);
          }
          return chain(rb);
        },
        in: (col: string, vals: unknown[]) => {
          if (rb && typeof rb["in"] === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return chain((rb["in"] as (...a: any[]) => unknown)(col, vals) as Record<string, unknown>);
          }
          return chain(rb);
        },
        limit: (n: number) => {
          if (rb && typeof rb["limit"] === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return chain((rb["limit"] as (...a: any[]) => unknown)(n) as Record<string, unknown>);
          }
          return chain(rb);
        },
        order: (col: string, opts?: unknown) => {
          if (rb && typeof rb["order"] === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return chain((rb["order"] as (...a: any[]) => unknown)(col, opts) as Record<string, unknown>);
          }
          return chain(rb);
        },
        single: async () => {
          if (rb && typeof rb["then"] === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const r = await (rb as any);
            return r as { data: unknown; error: null | { message: string } };
          }
          return { data: null, error: null };
        },
        then: (resolve, reject) => {
          if (rb && typeof rb["then"] === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (rb as any).then(resolve as Parameters<typeof Promise.prototype.then>[0], reject);
          }
          return Promise.resolve({ data: null, error: null }).then(
            resolve as Parameters<typeof Promise.prototype.then>[0],
            reject,
          );
        },
      };
      return b;
    };

    return chain(realBuilder);
  }

  return { from: (table: string) => makeBuilder(table) };
}

// ---------------------------------------------------------------------------
// Canonical-owner lookup by contact_id
// ---------------------------------------------------------------------------

/**
 * Looks up a canonical_owner_id for a given contact_id.
 *
 * Strategy: canonical_owner rows don't have a direct contact_id FK.
 * We match via the contact's full_name → owner_alias.alias_name_normalized,
 * falling back to canonical_owner.canonical_name_normalized.
 *
 * Returns null if no match found (lead should be skipped).
 */
async function findOwnerIdForContact(
  sb: ShadowSupabaseClient,
  lead: SnapshotLead,
): Promise<string | null> {
  // Determine the name to match against
  const ownerName = lead.company_name ?? lead.owner_full_name;
  if (!ownerName) return null;

  // Normalize the name (simple lowercase + collapse spaces)
  const normalized = ownerName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized) return null;

  // 1. Try owner_alias table first
  const { data: aliasRows } = await sb
    .from("owner_alias")
    .select("owner_id")
    .eq("alias_normalized", normalized)
    .limit(1);

  const aliasMatches = aliasRows as Array<{ owner_id: string }> | null;
  if (aliasMatches && aliasMatches.length > 0) {
    return aliasMatches[0].owner_id;
  }

  // 2. Try canonical_owner.canonical_name_normalized
  const { data: ownerRows } = await sb
    .from("canonical_owner")
    .select("owner_id")
    .eq("canonical_name_normalized", normalized)
    .limit(1);

  const ownerMatches = ownerRows as Array<{ owner_id: string }> | null;
  if (ownerMatches && ownerMatches.length > 0) {
    return ownerMatches[0].owner_id;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pipeline wrapper
// ---------------------------------------------------------------------------

async function runPipelineForLead(
  lead: SnapshotLead,
  sb: ShadowSupabaseClient,
  smokeTest: boolean,
): Promise<PipelineResult> {
  // Look up canonical_owner_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownerId = await findOwnerIdForContact(sb, lead);
  if (!ownerId) {
    return {
      outcome: "unresolved",
      reason: "no_canonical_owner: contact not found in canonical_owner table",
    };
  }

  const opts = smokeTest ? { skipBrave: true, skipTwilio: true } : {};

  try {
    // Determine routing (A or B) without triggering the full pipeline twice.
    // The routing decision is passed as precomputedRouting so runPipelineB
    // (and runPipelineA) do not call routeOwner a second time — avoiding a
    // potential race where a lazy-geocode write that occurred here produces a
    // different routing result on the second call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routing = await routeOwner(sb as any, ownerId);

    if (routing.pipeline === "A") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runPipelineA(sb as any, ownerId, opts);
      const isAccepted = result.primaryHypothesisId !== undefined;
      const hasCandidate = result.hypothesisIds.length > 0;

      // Determine the primary phone from hypothesis rows (in dry-run the
      // hypothesis_id will be undefined since inserts return null data).
      // We can't retrieve the phone value here without querying — but in
      // dry-run mode the hypothesis table isn't written, so phone_e164 will
      // be null. That's acceptable for the smoke-test report.
      return {
        outcome: isAccepted ? "released" : hasCandidate ? "held" : "unresolved",
        phone_e164: null, // not available in dry-run
        tier: null,
        by_pipeline: "A",
        reason: result.reason,
      };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runPipelineB(sb as any, ownerId, { ...opts, precomputedRouting: routing });
      const isAccepted = result.primaryHypothesisId !== undefined;
      const hasCandidate = result.hypothesisIds.length > 0;

      return {
        outcome: isAccepted ? "released" : hasCandidate ? "held" : "unresolved",
        phone_e164: null, // not available in dry-run
        tier: null,
        by_pipeline: "B",
        reason: result.reason,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outcome: "unresolved",
      reason: `pipeline_error: ${msg}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { snapshotPath, outputPath, smokeTest, persist } = parseArgs(process.argv);

  console.log("[run-backtest] Starting Phase 10 backtest...");
  console.log(`  Snapshot: ${snapshotPath}`);
  console.log(`  Output:   ${outputPath}`);
  console.log(`  Mode:     ${smokeTest ? "smoke-test (skip Brave + Twilio)" : "full"}`);
  console.log(`  Writes:   ${persist ? "persist (evidence/hypothesis allowed)" : "dry-run (no DB writes)"}`);

  // Load snapshot
  if (!existsSync(snapshotPath)) {
    console.error(`[run-backtest] Snapshot file not found: ${snapshotPath}`);
    process.exit(1);
  }

  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8")) as Snapshot;
  } catch (err) {
    console.error("[run-backtest] Failed to parse snapshot:", err);
    process.exit(1);
  }

  console.log(`[run-backtest] Loaded ${snapshot.leads.length} leads from snapshot.`);

  // Build the shadow client
  let shadowClient: ShadowSupabaseClient;
  if (persist) {
    // Normal shadow mode: evidence/hypothesis writes allowed
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!supabaseUrl || !serviceKey) {
      console.warn("[run-backtest] Warning: DB env vars missing; reads will return empty data.");
    }
    const realClient = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : undefined;
    shadowClient = createShadowClient(realClient);
  } else {
    // Dry-run mode: all writes silently dropped
    shadowClient = createDryRunClient();
  }

  // Build pipeline function
  const pipelineFn = async (
    lead: SnapshotLead,
    sb: ShadowSupabaseClient,
  ): Promise<PipelineResult> => {
    return runPipelineForLead(lead, sb, smokeTest);
  };

  // Run backtest (use the provided shadow client override)
  // We pass the shadowClient in via a closure rather than through the harness
  // so we can control dry-run vs persist mode ourselves.
  const report = await runBacktest(snapshot, (lead, _harnessClient) =>
    pipelineFn(lead, shadowClient), {
    includeDetails: true,
    concurrency: 1,
  });

  // Emit markdown report
  const md = toMarkdown(report);

  // Also emit sidecar JSON for compute-backtest-decision.ts
  const jsonSidecar = JSON.stringify(
    {
      ...report,
      smoke_test: smokeTest,
      dry_run: !persist,
      snapshot_path: snapshotPath,
    },
    null,
    2,
  );
  const jsonPath = outputPath.replace(/\.md$/, ".json");

  writeFileSync(outputPath, md, "utf-8");
  writeFileSync(jsonPath, jsonSidecar, "utf-8");

  console.log(`\n[run-backtest] Report written to: ${outputPath}`);
  console.log(`[run-backtest] JSON sidecar:      ${jsonPath}`);
  console.log("\n--- SUMMARY ---");
  console.log(`  Leads evaluated: ${report.leads_evaluated}`);
  console.log(`  Released:        ${report.released_count}`);
  console.log(`  Held:            ${report.held_count}`);
  console.log(`  Unresolved:      ${report.unresolved_count}`);
  console.log(
    `  Precision:       ${report.precision !== null ? `${(report.precision * 100).toFixed(1)}%` : "n/a"}`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[run-backtest] Fatal error:", err);
  process.exit(1);
});
