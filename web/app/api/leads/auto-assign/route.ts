import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autoAssignCallableLeads } from "@/lib/leads/auto-assign";

const Body = z.object({
  importJobId: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  try {
    const result = await autoAssignCallableLeads(sb, {
      importJobId: body.importJobId ?? null,
      assignedBy: auth.user.id,
      limit: body.limit,
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Auto-assignment failed" },
      { status: 500 },
    );
  }
}
