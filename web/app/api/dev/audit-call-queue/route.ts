// POST /api/dev/audit-call-queue
//
// Re-validates every phone attached to a `ready_to_call` lead against the
// v3 gate engine. Phones imported from Excel / entered manually / verified by
// callers are NEVER touched — only enrichment-derived phones get audited.
//
// Body: { dryRun?: boolean = true, limit?: number = 500, useHaiku?: boolean = false }
// Returns the audit summary (counts + per-failure-gate stats + up to 50 samples).
//
// Recommended workflow:
//   1. POST { dryRun: true, limit: 1000 } and review the response.
//   2. Inspect samples — confirm the audit is rejecting things you'd reject
//      manually.
//   3. POST { dryRun: false, limit: 1000 } to apply.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { auditCallQueue } from "@/lib/enrichment/audit-call-queue";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  dryRun: z.boolean().optional(),
  limit:  z.number().int().min(1).max(2000).optional(),
  useHaiku: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let opts: z.infer<typeof Body>;
  try { opts = Body.parse(await request.json().catch(() => ({}))); }
  catch (err) {
    return NextResponse.json(
      { ok: false, error: "Bad input", errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();
  const result = await auditCallQueue(sb, {
    dryRun:   opts.dryRun ?? true,   // safe default — dry-run unless asked
    limit:    opts.limit  ?? 500,
    useHaiku: opts.useHaiku ?? false,
  });
  return NextResponse.json({ ok: true, dryRun: opts.dryRun ?? true, data: result });
}
