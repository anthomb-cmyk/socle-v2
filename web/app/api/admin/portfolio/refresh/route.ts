// POST /api/admin/portfolio/refresh
// Admin-only endpoint that recomputes property_count and is_portfolio_owner
// for all contacts. Useful after bulk imports or data corrections.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { refreshPortfolioFlags } from "@/lib/portfolio/detector";

export const runtime = "nodejs";

export async function POST(_request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();

  try {
    const { updated } = await refreshPortfolioFlags(sb);
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    console.error("[portfolio/refresh] unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
