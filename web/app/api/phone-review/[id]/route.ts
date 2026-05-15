// POST /api/phone-review/[id]
// Body: { action: "approve" | "reject" | "retry" | "keep_unresolved" }
//
// approve        → promote phone_e164 to phones table as verified; lead → phone_verified
// reject         → mark rejected_by_anthony; if no other candidates → unresolved_after_openclaw
// retry          → re-run enrichment pipeline for this lead
// keep_unresolved → mark candidate rejected, lead → unresolved_after_openclaw

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { extractPhonesFromValue, formatDisplay } from "@/lib/role-parser/phone-utils";

const Body = z.object({
  action: z.enum(["approve", "reject", "retry", "keep_unresolved"]),
  note: z.string().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await ctx.params;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  const { data: candRaw } = await sb
    .from("phone_candidates")
    .select("id, lead_id, contact_id, phone_raw, phone_e164, stage, source_label, source_url, initial_confidence, candidate_status, matched_on, source_class")
    .eq("id", id)
    .single();

  type CandRow = {
    id: string;
    lead_id: string;
    contact_id: string | null;
    phone_raw: string;
    phone_e164: string | null;
    stage: string;
    source_label: string | null;
    source_url: string | null;
    initial_confidence: number;
    candidate_status: string;
    matched_on: string | null;
    source_class: string | null;
  };
  const cand = candRaw as CandRow | null;
  if (!cand) return NextResponse.json({ ok: false, error: "Candidate not found" }, { status: 404 });

  const now = new Date().toISOString();

  // ── approve ───────────────────────────────────────────────────────────────
  if (body.action === "approve") {
    if (!cand.phone_e164 && !cand.phone_raw) {
      return NextResponse.json({ ok: false, error: "No valid E.164 phone to promote" }, { status: 400 });
    }

    // Re-extract in case phone_e164 was null
    const e164 = cand.phone_e164 ?? extractPhonesFromValue(cand.phone_raw)[0] ?? null;
    if (!e164) {
      return NextResponse.json({ ok: false, error: `'${cand.phone_raw}' could not be parsed as a valid NANP phone` }, { status: 400 });
    }

    if (!cand.contact_id) {
      return NextResponse.json({ ok: false, error: "Candidate has no contact_id — cannot save to phones" }, { status: 400 });
    }

    // Upsert into phones table as verified
    const { error: phoneErr } = await sb.from("phones").upsert({
      contact_id: cand.contact_id,
      e164,
      display: formatDisplay(e164),
      status: "verified",
      source: cand.stage === "brave" ? "brave"
        : cand.stage === "directory_411" ? "411ca"
        : cand.stage === "place_api" ? "google_places"
        : "openclaw",
      confidence: cand.initial_confidence,
      evidence: cand.source_url ?? cand.source_label ?? "phone_review_approved",
      source_import_job_id: null,
    }, { onConflict: "contact_id,e164", ignoreDuplicates: false });

    if (phoneErr) {
      return NextResponse.json({ ok: false, error: `phones upsert: ${phoneErr.message}` }, { status: 500 });
    }

    const { data: phoneRow } = await sb
      .from("phones")
      .select("id")
      .eq("contact_id", cand.contact_id)
      .eq("e164", e164)
      .maybeSingle();

    // Update candidate
    await sb.from("phone_candidates").update({
      candidate_status: "approved_by_anthony",
      reviewed_by: user.id,
      reviewed_at: now,
      review_note: body.note ?? null,
    }).eq("id", id);

    // Update lead status
    await sb.from("leads").update({ status: "phone_verified" }).eq("id", cand.lead_id);

    // Log events
    await sb.from("enrichment_events").insert([
      {
        lead_id: cand.lead_id,
        event_type: "phone_approved_by_anthony",
        stage: cand.stage as never,
        candidate_id: id,
        payload: { phone_e164: e164, reviewed_by: user.id },
      },
      {
        lead_id: cand.lead_id,
        event_type: "lead_status_updated",
        stage: null,
        payload: { new_status: "phone_verified" },
      },
    ]);

    await sb.from("source_trust_observations").insert({
      lead_id: cand.lead_id,
      phone_id: (phoneRow as { id?: string } | null)?.id ?? null,
      phone_candidate_id: cand.id,
      source_label: cand.source_label,
      source_class: cand.source_class,
      matched_on: cand.matched_on,
      observation: "manual_approved",
      confidence: Number(((cand.initial_confidence ?? 0) / 100).toFixed(4)),
      observed_by: user.id,
      payload: {
        action: "approve",
        note: body.note ?? null,
      },
    });

    return NextResponse.json({ ok: true, action: "approved", phoneE164: e164 });
  }

  // ── reject ────────────────────────────────────────────────────────────────
  if (body.action === "reject") {
    await sb.from("phone_candidates").update({
      candidate_status: "rejected_by_anthony",
      reviewed_by: user.id,
      reviewed_at: now,
      review_note: body.note ?? null,
    }).eq("id", id);

    await sb.from("enrichment_events").insert({
      lead_id: cand.lead_id,
      event_type: "phone_rejected_by_anthony",
      stage: cand.stage as never,
      candidate_id: id,
      payload: { reviewed_by: user.id, note: body.note ?? null },
    });

    await sb.from("source_trust_observations").insert({
      lead_id: cand.lead_id,
      phone_candidate_id: cand.id,
      source_label: cand.source_label,
      source_class: cand.source_class,
      matched_on: cand.matched_on,
      observation: "manual_rejected",
      confidence: Number(((cand.initial_confidence ?? 0) / 100).toFixed(4)),
      observed_by: user.id,
      payload: {
        action: "reject",
        note: body.note ?? null,
      },
    });

    // Check if any remaining reviewable candidates exist for this lead
    const { data: remaining } = await sb
      .from("phone_candidates")
      .select("id")
      .eq("lead_id", cand.lead_id)
      .eq("candidate_status", "needs_anthony_review")
      .neq("id", id)
      .limit(1);

    if (!remaining || remaining.length === 0) {
      await sb.from("leads").update({ status: "unresolved_after_openclaw" }).eq("id", cand.lead_id);
      await sb.from("enrichment_events").insert({
        lead_id: cand.lead_id,
        event_type: "unresolved_after_openclaw",
        stage: null,
        payload: { reason: "all candidates rejected by anthony" },
      });
    }

    return NextResponse.json({ ok: true, action: "rejected" });
  }

  // ── keep_unresolved ────────────────────────────────────────────────────────
  if (body.action === "keep_unresolved") {
    await sb.from("phone_candidates").update({
      candidate_status: "rejected_by_anthony",
      reviewed_by: user.id,
      reviewed_at: now,
      review_note: body.note ?? null,
    }).eq("id", id);

    await sb.from("leads").update({ status: "unresolved_after_openclaw" }).eq("id", cand.lead_id);

    await sb.from("enrichment_events").insert({
      lead_id: cand.lead_id,
      event_type: "unresolved_after_openclaw",
      stage: null,
      payload: { reason: "kept unresolved by anthony", note: body.note ?? null },
    });

    await sb.from("source_trust_observations").insert({
      lead_id: cand.lead_id,
      phone_candidate_id: cand.id,
      source_label: cand.source_label,
      source_class: cand.source_class,
      matched_on: cand.matched_on,
      observation: "manual_rejected",
      confidence: Number(((cand.initial_confidence ?? 0) / 100).toFixed(4)),
      observed_by: user.id,
      payload: {
        action: "keep_unresolved",
        note: body.note ?? null,
      },
    });

    return NextResponse.json({ ok: true, action: "kept_unresolved" });
  }

  // ── retry ─────────────────────────────────────────────────────────────────
  if (body.action === "retry") {
    // Kick off a new pipeline run via internal fetch
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3000";

    const r = await fetch(`${baseUrl}/api/enrichment/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Pass the session cookie through for admin auth
        Cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ leadId: cand.lead_id }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: "unknown" }));
      return NextResponse.json({ ok: false, error: (err as { error?: string }).error ?? "retry failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, action: "retry_started" });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
