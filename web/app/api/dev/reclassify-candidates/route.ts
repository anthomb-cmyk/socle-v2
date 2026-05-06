// POST /api/dev/reclassify-candidates
//
// Re-runs the v3 gate engine over every existing pending phone_candidate.
// Admin-only. Used as a one-time backfill after migration 0015.
//
// Body: { skipHaiku?: boolean, limit?: number }
// Returns the reclassify summary.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { reclassifyAllPendingCandidates } from "@/lib/enrichment/reclassify-existing";

export const runtime = "nodejs";
export const maxDuration = 300; // up to 5 minutes for big backfills

const Body = z.object({
  skipHaiku: z.boolean().optional(),
  limit:     z.number().int().min(1).max(2000).optional(),
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
  const result = await reclassifyAllPendingCandidates(sb, opts);
  return NextResponse.json({ ok: true, data: result });
}
