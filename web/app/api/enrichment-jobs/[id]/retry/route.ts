// POST /api/enrichment-jobs/[id]/retry — admin only.
// Resets a failed/cancelled/completed job back to pending and (best-effort) re-fires
// the correct n8n webhook for the job's original workflow:
//   - workflow_id contains "openclaw" → POST to OPENCLAW_WEBHOOK_URL with the
//     same deep_search payload force-openclaw uses (LeadContext + callback URL)
//   - job_type === find_email          → POST to the inline email runner
//   - otherwise                       → POST to N8N_ENRICHMENT_WEBHOOK_URL with
//     the legacy retry payload
// Bumps attempts.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { requestOpenclawDeepSearch } from "@/lib/enrichment/openclaw-validate";
import type { LeadContext } from "@/lib/enrichment/types";

type LeadJoined = {
  id: string;
  contact_id: string;
  status: string;
  properties: { address: string; city: string | null; matricule: string | null; num_units: number | null } | null;
  contacts: {
    id: string;
    full_name: string | null;
    company_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
  } | null;
};

function isOpenclawWorkflow(workflowId: string | null | undefined): boolean {
  return !!workflowId && workflowId.toLowerCase().includes("openclaw");
}

function buildLeadContext(lead: LeadJoined, enrichmentJobId: string): LeadContext {
  const rawFullName = lead.contacts?.full_name ?? null;
  let primaryName: string | null = rawFullName;
  let secondaryName: string | null = null;
  if (rawFullName) {
    const sep = rawFullName.match(/\s*[\/|]\s*|\s+et\s+|\s+and\s+/i);
    if (sep?.index !== undefined) {
      primaryName   = rawFullName.slice(0, sep.index).trim() || null;
      secondaryName = rawFullName.slice(sep.index + sep[0].length).trim() || null;
    }
  }
  return {
    leadId:          lead.id,
    contactId:       lead.contact_id,
    enrichmentJobId,
    fullName:        primaryName,
    companyName:     lead.contacts?.company_name ?? null,
    secondaryName,
    propertyAddress: lead.properties?.address ?? null,
    propertyCity:    lead.properties?.city ?? null,
    mailingAddress:  lead.contacts?.mailing_address ?? null,
    mailingCity:     lead.contacts?.mailing_city ?? null,
    mailingPostal:   lead.contacts?.mailing_postal ?? null,
    matricule:       lead.properties?.matricule ?? null,
    numUnits:        lead.properties?.num_units ?? null,
  };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { data: jobRaw } = await sb.from("enrichment_jobs").select("*").eq("id", id).single();
  const job = jobRaw as {
    id: string; lead_id: string | null; contact_id: string | null; job_type: string;
    status: string; attempts: number; max_attempts: number; workflow_id: string | null;
  } | null;
  if (!job) return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  if (job.status === "processing" || job.status === "pending") {
    return NextResponse.json({ ok: false, error: `Job is ${job.status} — cancel first if you want to retry from a clean slate.` }, { status: 409 });
  }

  await sb.from("enrichment_jobs").update({
    status: "pending",
    attempts: (job.attempts ?? 0) + 1,
    started_at: null,
    completed_at: null,
    error_message: null,
  }).eq("id", id);

  let webhookCalled = false;
  let webhookError: string | null = null;
  const route: "openclaw" | "inline_email" | "n8n_default" | "none" =
    job.job_type === "find_email"
      ? "inline_email"
      : isOpenclawWorkflow(job.workflow_id)
        ? "openclaw"
        : (process.env.N8N_ENRICHMENT_WEBHOOK_URL ? "n8n_default" : "none");

  if (route === "openclaw") {
    // OpenClaw retry path — re-fire the deep_search webhook (W8) with full lead context.
    if (!process.env.OPENCLAW_WEBHOOK_URL) {
      webhookError = "OPENCLAW_WEBHOOK_URL not configured";
    } else if (!job.lead_id) {
      webhookError = "Job has no lead_id — cannot rebuild OpenClaw context";
    } else {
      const { data: leadRaw } = await sb
        .from("leads")
        .select(`
          id, contact_id, status,
          properties ( address, city, matricule, num_units ),
          contacts ( id, full_name, company_name, mailing_address, mailing_city, mailing_postal )
        `)
        .eq("id", job.lead_id)
        .single();
      const lead = leadRaw as LeadJoined | null;
      if (!lead) {
        webhookError = "Lead not found";
      } else {
        const ctxLead = buildLeadContext(lead, id);
        try {
          const result = await requestOpenclawDeepSearch(ctxLead, []);
          if (result.dispatched) {
            webhookCalled = true;
            await sb.from("enrichment_jobs")
              .update({ status: "processing", started_at: new Date().toISOString() })
              .eq("id", id);
            await sb.from("leads")
              .update({ status: "openclaw_researching" })
              .eq("id", lead.id);
            await sb.from("enrichment_events").insert({
              lead_id:    lead.id,
              event_type: "openclaw_dispatched",
              stage:      "openclaw",
              payload:    {
                source:        "admin_retry",
                prior_status:  lead.status,
                attempts:      (job.attempts ?? 0) + 1,
              },
            });
          } else {
            webhookError = result.reason ?? "OpenClaw dispatch returned not-dispatched";
          }
        } catch (err) {
          webhookError = (err as Error).message ?? "requestOpenclawDeepSearch threw unexpectedly";
        }
      }
    }
    if (!webhookCalled) {
      // Mark the job failed so it doesn't sit pending forever
      await sb.from("enrichment_jobs").update({
        status:        "failed",
        completed_at:  new Date().toISOString(),
        error_message: webhookError,
      }).eq("id", id);
    }
  } else if (route === "inline_email") {
    if (!process.env.N8N_SHARED_KEY) {
      webhookError = "N8N_SHARED_KEY not configured — inline email runner cannot authenticate";
    } else if (!job.lead_id) {
      webhookError = "Job has no lead_id — cannot run email search";
    } else {
      try {
        const r = await fetch(new URL("/api/enrichment/run", request.url), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.N8N_SHARED_KEY}`,
          },
          body: JSON.stringify({
            enrichment_job_id: id,
            lead_id: job.lead_id,
            job_type: job.job_type,
          }),
        });
        if (r.ok) {
          webhookCalled = true;
        } else {
          webhookError = `Inline runner returned ${r.status}`;
        }
      } catch (err) {
        webhookError = (err as Error).message;
      }
    }
    if (!webhookCalled) {
      await sb.from("enrichment_jobs").update({
        status:        "failed",
        completed_at:  new Date().toISOString(),
        error_message: webhookError,
      }).eq("id", id);
    }
  } else if (route === "n8n_default") {
    // Default n8n webhook (Brave / generic find_phone workflows)
    const webhookUrl = process.env.N8N_ENRICHMENT_WEBHOOK_URL!;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.N8N_SHARED_KEY) headers["Authorization"] = `Bearer ${process.env.N8N_SHARED_KEY}`;
      const r = await fetch(webhookUrl, {
        method: "POST", headers,
        body: JSON.stringify({ enrichment_job_id: id, lead_id: job.lead_id, contact_id: job.contact_id, job_type: job.job_type, retry: true }),
      });
      if (r.ok) {
        webhookCalled = true;
        await sb.from("enrichment_jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", id);
      } else {
        webhookError = `Webhook returned ${r.status}`;
      }
    } catch (err) {
      webhookError = (err as Error).message;
    }
  } else {
    webhookError = "No webhook configured for this workflow type";
  }

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "enrichment_job_retried",
    status: webhookError ? "partial" : "success",
    related_lead_id: job.lead_id, related_contact_id: job.contact_id,
    triggered_by: user.id,
    payload: {
      jobId: id,
      attempts: (job.attempts ?? 0) + 1,
      webhookCalled,
      webhookConfigured: route !== "none",
      route,
      workflow_id: job.workflow_id,
    },
    error_message: webhookError,
  });

  return NextResponse.json({ ok: true, data: { jobId: id, attempts: (job.attempts ?? 0) + 1, webhookCalled, webhookError, route } });
}
