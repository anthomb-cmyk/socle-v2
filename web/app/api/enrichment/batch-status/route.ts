// GET /api/enrichment/batch-status?leadIds=uuid1,uuid2,...
// Admin-only. Returns aggregate progress for a batch of leads.
// Max 500 lead IDs comma-separated.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const raw = url.searchParams.get("leadIds") ?? "";
  if (!raw) {
    return NextResponse.json({ ok: false, error: "leadIds query param required" }, { status: 400 });
  }

  const leadIds = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 500);
  if (leadIds.length === 0) {
    return NextResponse.json({ ok: false, error: "No valid leadIds provided" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  // ── Most-recent enrichment_job per lead ──────────────────────────────────
  // Supabase doesn't expose DISTINCT ON directly, so we use a workaround:
  // fetch all recent jobs for these leads ordered by created_at desc, then
  // deduplicate in JS (keeps latest per lead_id).
  const { data: allJobs, error: jobsErr } = await sb
    .from("enrichment_jobs")
    .select("id, lead_id, status, started_at")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: false })
    .limit(leadIds.length * 10); // generous upper bound

  if (jobsErr) {
    return NextResponse.json({ ok: false, error: jobsErr.message }, { status: 500 });
  }

  // Deduplicate: keep most recent job per lead
  type JobRow = { id: string; lead_id: string; status: string; started_at: string | null };
  const latestByLead = new Map<string, JobRow>();
  for (const row of ((allJobs ?? []) as JobRow[])) {
    if (!latestByLead.has(row.lead_id)) {
      latestByLead.set(row.lead_id, row);
    }
  }

  const jobs = Array.from(latestByLead.values());
  const jobIds = jobs.map(j => j.id);

  // ── Status breakdown ─────────────────────────────────────────────────────
  const by_status = { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
  let earliestStartedAt: string | null = null;

  for (const j of jobs) {
    const s = j.status as keyof typeof by_status;
    if (s in by_status) by_status[s]++;
    if (j.started_at) {
      if (!earliestStartedAt || j.started_at < earliestStartedAt) {
        earliestStartedAt = j.started_at;
      }
    }
  }

  const total = leadIds.length;
  const inProgress = by_status.pending + by_status.processing;

  // ── phone_candidates created from these jobs ─────────────────────────────
  let candidates_total = 0;
  let auto_attached_count = 0;
  let needs_review_count = 0;

  if (jobIds.length > 0) {
    const { data: candidates, error: candErr } = await sb
      .from("phone_candidates")
      .select("id, candidate_status, enrichment_job_id")
      .in("enrichment_job_id", jobIds);

    if (!candErr && candidates) {
      type CandRow = { id: string; candidate_status: string; enrichment_job_id: string | null };
      const rows = candidates as CandRow[];
      candidates_total = rows.length;
      auto_attached_count = rows.filter(r => r.candidate_status === "auto_attached").length;
      needs_review_count  = rows.filter(r => r.candidate_status === "needs_anthony_review").length;
    }
  }

  // ── Leads that now have a phone in the canonical phones table ────────────
  // We look up via leads → contact_id → phones
  let leads_with_phone = 0;
  {
    const { data: leadContacts } = await sb
      .from("leads")
      .select("id, contact_id")
      .in("id", leadIds);

    if (leadContacts && leadContacts.length > 0) {
      type LeadContact = { id: string; contact_id: string | null };
      const contactIds = (leadContacts as LeadContact[])
        .map(l => l.contact_id)
        .filter((c): c is string => !!c);

      if (contactIds.length > 0) {
        const { data: phonedContacts } = await sb
          .from("phones")
          .select("contact_id")
          .in("contact_id", contactIds);

        if (phonedContacts) {
          const contactsWithPhone = new Set(
            (phonedContacts as Array<{ contact_id: string }>).map(p => p.contact_id),
          );
          leads_with_phone = (leadContacts as LeadContact[]).filter(
            l => l.contact_id && contactsWithPhone.has(l.contact_id),
          ).length;
        }
      }
    }
  }

  // ── Elapsed seconds ──────────────────────────────────────────────────────
  let elapsed_seconds: number | null = null;
  if (inProgress > 0 && earliestStartedAt) {
    elapsed_seconds = Math.floor((Date.now() - new Date(earliestStartedAt).getTime()) / 1000);
  }

  return NextResponse.json({
    ok: true,
    data: {
      total,
      by_status,
      candidates_total,
      auto_attached_count,
      needs_review_count,
      leads_with_phone,
      elapsed_seconds,
    },
  });
}
