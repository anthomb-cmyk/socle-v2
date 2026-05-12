// POST /api/cron/process-queue
//
// Admin-only endpoint called by GitHub Actions/Railway cron (or any external
// scheduler). Drains pending queue work in repeated batches until either the
// queue is empty or the request reaches a safe runtime budget.
//
// Security: Bearer token must match CRON_SECRET env var, OR the caller must
// be an authenticated admin. Both paths are checked.

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { processNextBatch } from "@/lib/queue/worker";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 30;
const TOTAL_RUNTIME_BUDGET_MS = 230_000;
const PER_BATCH_RUNTIME_BUDGET_MS = 90_000;
const MIN_RUNTIME_REMAINING_MS = 10_000;

export async function POST(req: Request): Promise<NextResponse> {
  // ── Auth: accept CRON_SECRET bearer OR admin session ─────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";

  let authorized = false;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    authorized = true;
  }

  if (!authorized) {
    // Fall back to session auth
    try {
      const { createSupabaseServerClient } = await import("@/lib/supabase-server");
      const supabase = await createSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.app_metadata?.role === "admin") {
        authorized = true;
      }
    } catch {
      // no session
    }
  }

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseAdminClient();

  try {
    const startedAt = Date.now();
    const deadline = startedAt + TOTAL_RUNTIME_BUDGET_MS;
    const totals = { processed: 0, succeeded: 0, failed: 0 };
    const batches: Array<{ processed: number; succeeded: number; failed: number }> = [];
    let drained = false;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_RUNTIME_REMAINING_MS) break;

      const result = await processNextBatch(sb, {
        batchSize: BATCH_SIZE,
        maxRuntimeMs: Math.min(PER_BATCH_RUNTIME_BUDGET_MS, remaining - 1_000),
      });

      batches.push(result);
      totals.processed += result.processed;
      totals.succeeded += result.succeeded;
      totals.failed += result.failed;

      if (result.processed === 0) {
        drained = true;
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        ...totals,
        batches: batches.length,
        drained,
        runtimeMs: Date.now() - startedAt,
        batchSize: BATCH_SIZE,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[process-queue] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
