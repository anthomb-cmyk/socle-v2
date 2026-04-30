// POST /api/enrichment-jobs — create + (optionally) fire n8n webhook.
// GET  /api/enrichment-jobs — list (admin only).
//
// POST body: { leadId, jobType?, contactId? }
//   jobType defaults to 'find_phone'. Values: find_phone | verify_phone |
//   find_email | find_website | owner_identity | property_context | general_research

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const JOB_TYPES = ["find_phone", "verify_phone", "find_email", "find_website", "owner_identity", "property_context", "general_research"] as const;

const Create = z.object({
  leadId: z.string().uuid(),
  jobType: z.enum(JOB_TYPES).optional(),
  contactId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body;
  try { body = Create.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // Verify the lead exists; pull contact_id if not provided
  const { data: lead } = await sb.from("leads").select("id, contact_id").eq("id", body.leadId).single();
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  const contactId = body.contactId ?? (lead as { contact_id: string }).contact_id;

  const jobType = body.jobType ?? "find_phone";

  const { data: jobRow, error: jobErr } = await sb.from("enrichment_jobs").insert({
    lead_id: body.leadId,
    contact_id: contactId,
    workflow_id: `n8n_${jobType}`,
    job_type: jobType,
    status: "pending",
    raw_input: { leadId: body.leadId, contactId, jobType, requestedBy: user.id },
  }).select("id").single();
  if (jobErr) return NextResponse.json({ ok: false, error: jobErr.message }, { status: 500 });
  const jobId = (jobRow as { id: string }).id;

  // Fire webhook if configured
  const webhookUrl = process.env.N8N_ENRICHMENT_WEBHOOK_URL;
  let webhookCalled = false;
  let webhookError: string | null = null;
  if (webhookUrl) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.N8N_SHARED_KEY) headers["Authorization"] = `Bearer ${process.env.N8N_SHARED_KEY}`;
      const r = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ enrichment_job_id: jobId, lead_id: body.leadId, contact_id: contactId, job_type: jobType }),
      });
      if (!r.ok) {
        webhookError = `Webhook returned ${r.status}`;
      } else {
        webhookCalled = true;
        await sb.from("enrichment_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", jobId);
      }
    } catch (err) {
      webhookError = (err as Error).message;
    }
  }

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "enrichment_job_created",
    status: webhookError ? "partial" : "success",
    related_lead_id: body.leadId,
    related_contact_id: contactId,
    triggered_by: user.id,
    payload: { jobId, jobType, webhookCalled, webhookConfigured: !!webhookUrl },
    error_message: webhookError,
  });

  return NextResponse.json({
    ok: true,
    data: {
      jobId,
      jobType,
      webhookCalled,
      webhookError,
      message: webhookCalled
        ? "Job created and webhook fired."
        : webhookUrl
          ? "Job created but webhook returned an error — see webhookError."
          : "Job created. N8N_ENRICHMENT_WEBHOOK_URL not configured — n8n will need to poll, or set the env var.",
    },
  });
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const leadId = url.searchParams.get("leadId");
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);

  const sb = createSupabaseAdminClient();
  let q = sb.from("enrichment_jobs")
    .select("id, lead_id, contact_id, job_type, workflow_id, workflow_run_id, status, attempts, started_at, completed_at, error_message, cost_usd, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (leadId) q = q.eq("lead_id", leadId);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
