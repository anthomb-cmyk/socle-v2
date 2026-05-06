// POST /api/dev/reparse-contacts
//
// Backfill: re-runs the v3 import-time parser over every contact whose
// mailing_parsed_at IS NULL. Populates structured mailing-address columns
// and name-parser audit fields.
//
// Body: { limit?: number, dryRun?: boolean }
// Returns the reparse summary.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { reparseAllContacts } from "@/lib/role-parser/reparse-contacts";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  limit: z.number().int().min(1).max(5000).optional(),
  dryRun: z.boolean().optional(),
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
  const result = await reparseAllContacts(sb, opts);
  return NextResponse.json({ ok: true, data: result });
}
