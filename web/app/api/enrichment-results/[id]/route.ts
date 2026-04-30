// POST /api/enrichment-results/[id]
// Body: { action: "approve" | "reject" }
//
// Approve behavior by kind:
//   phone   → upsert into phones (if not duplicate); status -> verified
//   email   → set contacts.primary_email if not already set
//   website → set contacts.primary_website if not already set
//   owner_identity / property_fact / note → record only, no auto-write
//
// Reject behavior: mark enrichment_results.status='invalid', no other changes.
//
// Both paths log automation_events.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { extractPhonesFromValue, formatDisplay } from "@/lib/role-parser/phone-utils";

const Body = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await ctx.params;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();
  const { data: rowRaw } = await sb.from("enrichment_results").select("*").eq("id", id).single();
  const row = rowRaw as {
    id: string; contact_id: string | null; lead_id: string | null;
    kind: string; value: string; source: string; source_url: string | null;
    confidence: number; evidence: string | null; status: string;
  } | null;
  if (!row) return NextResponse.json({ ok: false, error: "Result not found" }, { status: 404 });
  if (row.status !== "unverified") {
    return NextResponse.json({ ok: false, error: `Already ${row.status}` }, { status: 409 });
  }

  if (body.action === "reject") {
    await sb.from("enrichment_results").update({
      status: "invalid", reviewed_by: user.id, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    await sb.from("automation_events").insert({
      source: "web_app", event_type: "enrichment_result_rejected", status: "success",
      related_lead_id: row.lead_id, related_contact_id: row.contact_id,
      triggered_by: user.id,
      payload: { resultId: id, kind: row.kind, value: row.value },
    });
    return NextResponse.json({ ok: true, action: "rejected" });
  }

  // Approve — apply by kind
  let applied: unknown = null;
  let applyError: string | null = null;

  if (row.kind === "phone") {
    if (!row.contact_id) {
      applyError = "Cannot apply phone — no contact_id on result";
    } else {
      const e164List = extractPhonesFromValue(row.value);
      if (e164List.length === 0) {
        applyError = `Value '${row.value}' is not a valid NANP phone`;
      } else {
        const e164 = e164List[0];
        const { error: insErr } = await sb.from("phones").upsert({
          contact_id: row.contact_id,
          e164,
          display: formatDisplay(e164),
          status: "verified",
          source: row.source.includes("brave") ? "brave"
                : row.source.includes("places") || row.source.includes("google") ? "google_places"
                : row.source.includes("pages") ? "pages_jaunes"
                : row.source.includes("411") ? "411ca"
                : "enrichment_other",
          confidence: row.confidence,
          evidence: row.evidence ?? row.source_url ?? row.source,
        }, { onConflict: "contact_id,e164", ignoreDuplicates: false });
        if (insErr) applyError = insErr.message;
        else applied = { phone_e164: e164 };
      }
    }
  } else if (row.kind === "email") {
    if (row.contact_id) {
      const { data: c } = await sb.from("contacts").select("primary_email").eq("id", row.contact_id).single();
      if (!(c as { primary_email: string | null } | null)?.primary_email) {
        await sb.from("contacts").update({ primary_email: row.value }).eq("id", row.contact_id);
        applied = { email_set: row.value };
      } else {
        applied = { email_already_set: true };
      }
    } else applyError = "no contact_id";
  } else if (row.kind === "website") {
    if (row.contact_id) {
      const { data: c } = await sb.from("contacts").select("primary_website").eq("id", row.contact_id).single();
      if (!(c as { primary_website: string | null } | null)?.primary_website) {
        await sb.from("contacts").update({ primary_website: row.value }).eq("id", row.contact_id);
        applied = { website_set: row.value };
      } else {
        applied = { website_already_set: true };
      }
    } else applyError = "no contact_id";
  } else {
    // owner_identity / property_fact / note — record-only acceptance
    applied = { kind: row.kind, recorded_only: true };
  }

  await sb.from("enrichment_results").update({
    status: applyError ? "unverified" : "verified",
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", id);

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: applyError ? "enrichment_result_apply_failed" : "enrichment_result_accepted",
    status: applyError ? "failed" : "success",
    related_lead_id: row.lead_id,
    related_contact_id: row.contact_id,
    triggered_by: user.id,
    error_message: applyError,
    payload: { resultId: id, kind: row.kind, value: row.value },
    result: applied,
  });

  if (applyError) return NextResponse.json({ ok: false, error: applyError }, { status: 500 });
  return NextResponse.json({ ok: true, action: "accepted", applied });
}
