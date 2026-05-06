// POST /api/cron/process-queue
//
// Admin-only endpoint called by Railway cron (or any external scheduler)
// every minute. Processes the next batch of pending enrichment tasks.
//
// Security: Bearer token must match CRON_SECRET env var, OR the caller must
// be an authenticated admin. Both paths are checked.

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { processNextBatch } from "@/lib/queue/worker";

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
    const result = await processNextBatch(sb, { batchSize: 10, maxRuntimeMs: 50_000 });
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[process-queue] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
