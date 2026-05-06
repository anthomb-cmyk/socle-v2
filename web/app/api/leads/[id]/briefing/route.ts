// POST /api/leads/[id]/briefing
//
// Generates or returns the cached AI briefing for a lead.
// Admin-only. Body: { regenerate?: boolean }
// - If briefing_generated_at is within 24 hours and regenerate=false → returns cached.
// - Otherwise calls generateBriefing and persists the result.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { generateBriefing } from "@/lib/llm/briefing";

const CACHE_HOURS = 24;

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  let body: { regenerate?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // No body is fine — defaults apply
  }
  const forceRegen = body.regenerate === true;

  const sb = createSupabaseAdminClient();

  // Check lead exists + fetch cached briefing fields.
  // If migration 0017 hasn't been applied yet, the briefing columns won't exist
  // (error code 42703). In that case we still confirm the lead exists and
  // proceed straight to generation (skip cache check).
  let row: { id: string; briefing_text: string | null; briefing_generated_at: string | null };

  try {
    const { data: leadRow, error: leadErr } = await sb
      .from("leads")
      .select("id, briefing_text, briefing_generated_at")
      .eq("id", id)
      .single();

    if (leadErr) {
      // 42703 = column does not exist (migration pending) → fall back to id-only check
      if (leadErr.code === "42703" || leadErr.code === "42P01") {
        const { data: idRow, error: idErr } = await sb
          .from("leads")
          .select("id")
          .eq("id", id)
          .single();
        if (idErr || !idRow) {
          return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
        }
        row = { id: (idRow as { id: string }).id, briefing_text: null, briefing_generated_at: null };
      } else {
        return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
      }
    } else if (!leadRow) {
      return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
    } else {
      row = leadRow as { id: string; briefing_text: string | null; briefing_generated_at: string | null };
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  }

  // Check cache freshness
  if (!forceRegen && row.briefing_text && row.briefing_generated_at) {
    const generatedAt = new Date(row.briefing_generated_at);
    const ageMs = Date.now() - generatedAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < CACHE_HOURS) {
      return NextResponse.json({
        ok: true,
        data: {
          text:        row.briefing_text,
          generatedAt: row.briefing_generated_at,
          cached:      true,
        },
      });
    }
  }

  // Generate (or regenerate)
  const briefing = await generateBriefing(id, sb);
  if (!briefing) {
    return NextResponse.json(
      { ok: false, error: "Briefing generation failed. Check ANTHROPIC_API_KEY and Supabase connectivity." },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await sb
    .from("leads")
    .update({
      briefing_text:         briefing.text,
      briefing_generated_at: now,
      briefing_metadata:     briefing.metadata,
    })
    .eq("id", id);

  if (updateErr) {
    // 42703 = column does not exist (migration 0017 pending) — not an app error.
    if (updateErr.code !== "42703" && updateErr.code !== "42P01") {
      console.error("[briefing route] update failed:", updateErr.message);
    }
    // Return the text anyway — generation succeeded even if persistence failed
    return NextResponse.json({
      ok: true,
      data: { text: briefing.text, generatedAt: now, cached: false },
      warning: "Briefing generated but could not be saved to DB.",
    });
  }

  return NextResponse.json({
    ok: true,
    data: { text: briefing.text, generatedAt: now, cached: false },
  });
}
