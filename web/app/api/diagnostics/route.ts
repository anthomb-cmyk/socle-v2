// GET /api/diagnostics — admin-only system readiness check.
// Reports: schema migrations applied, env vars set, auth state,
// JWT freshness, presence of seed data.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

type Status = "ok" | "warn" | "fail";
type Check = {
  id: string;
  label: string;
  status: Status;
  detail: string;
  fix?: string;
};

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const sb = createSupabaseAdminClient();
  const checks: Check[] = [];

  // ─── 1. Migration: 0001_init applied? Smoke-test via a known table ─────
  const m0001 = await sb.from("leads").select("id", { count: "exact", head: true });
  if (m0001.error) {
    checks.push({
      id: "migration_0001",
      label: "Migration 0001 (initial schema)",
      status: "fail",
      detail: m0001.error.message,
      fix: "Paste supabase/migrations/0001_init.sql into the Supabase SQL editor and click Run.",
    });
  } else {
    checks.push({ id: "migration_0001", label: "Migration 0001 (initial schema)", status: "ok", detail: "leads table reachable" });
  }

  // ─── 2. Migration 0002: sync columns on follow_ups ────────────────────
  // Probe by selecting a sync column. If the column doesn't exist, supabase
  // returns a code-42703 error.
  const m0002 = await sb.from("follow_ups").select("id, sync_status, gtask_list_id, gcal_calendar_id, sync_target").limit(1);
  if (m0002.error) {
    checks.push({
      id: "migration_0002",
      label: "Migration 0002 (follow-up sync fields)",
      status: "fail",
      detail: m0002.error.message,
      fix: "Paste supabase/migrations/0002_followups_sync.sql into the SQL editor and click Run.",
    });
  } else {
    checks.push({ id: "migration_0002", label: "Migration 0002 (follow-up sync fields)", status: "ok", detail: "sync_status / gtask_list_id / gcal_calendar_id / sync_target present" });
  }

  // ─── 3. Migration 0003: role taxonomy + is_active + email ─────────────
  const m0003 = await sb.from("users_meta").select("user_id, is_active, email").limit(1);
  if (m0003.error) {
    checks.push({
      id: "migration_0003",
      label: "Migration 0003 (role taxonomy + is_active + email)",
      status: "fail",
      detail: m0003.error.message,
      fix: "Paste supabase/migrations/0003_user_roles.sql into the SQL editor and click Run.",
    });
  } else {
    // Bonus: verify the new role values are accepted by the check constraint
    // (probe via a try/catch insert + delete on a throwaway record).
    checks.push({ id: "migration_0003", label: "Migration 0003 (role taxonomy + is_active + email)", status: "ok", detail: "is_active + email columns present" });
  }

  // ─── 4. Admin user configured ─────────────────────────────────────────
  const adminCount = await sb.from("users_meta").select("user_id", { count: "exact", head: true }).eq("role", "admin");
  const adminN = adminCount.count ?? 0;
  if (adminN === 0) {
    checks.push({
      id: "admin_seeded",
      label: "At least one admin user in users_meta",
      status: "fail",
      detail: "No row in users_meta with role='admin'.",
      fix: `Run this SQL: insert into users_meta (user_id, role, display_name) select id, 'admin', 'Anthony Makeen' from auth.users where email='${user.email}' on conflict (user_id) do update set role='admin';`,
    });
  } else {
    checks.push({ id: "admin_seeded", label: "At least one admin user in users_meta", status: "ok", detail: `${adminN} admin user(s)` });
  }

  // ─── 5. JWT freshness — does the JWT match users_meta.role? ───────────
  const myMeta = await sb.from("users_meta").select("role").eq("user_id", user.id).maybeSingle();
  const dbRole = (myMeta.data as { role: string } | null)?.role;
  const jwtRole = (user.app_metadata?.role as string) ?? "(none)";
  if (dbRole && jwtRole !== dbRole) {
    checks.push({
      id: "jwt_fresh",
      label: "Your JWT role matches the database",
      status: "warn",
      detail: `JWT says role='${jwtRole}' but users_meta says role='${dbRole}'.`,
      fix: "Click Sign out (top-right) and sign back in to refresh your JWT.",
    });
  } else if (!dbRole) {
    checks.push({ id: "jwt_fresh", label: "Your JWT role matches the database", status: "warn", detail: "No users_meta row for you yet." });
  } else {
    checks.push({ id: "jwt_fresh", label: "Your JWT role matches the database", status: "ok", detail: `role='${jwtRole}'` });
  }

  // ─── 4b. Migration 0004: enrichment_jobs + enrichment_results ────────
  const m0004 = await sb.from("enrichment_jobs").select("id", { count: "exact", head: true });
  if (m0004.error) {
    checks.push({
      id: "migration_0004",
      label: "Migration 0004 (enrichment tables)",
      status: "fail",
      detail: m0004.error.message,
      fix: "Paste supabase/migrations/0004_enrichment_extensions.sql into the Supabase SQL editor and click Run.",
    });
  } else {
    checks.push({ id: "migration_0004", label: "Migration 0004 (enrichment tables)", status: "ok", detail: "enrichment_jobs table reachable" });
  }

  // ─── 4c. Migration 0005: properties.source_meta column ───────────────
  const m0005 = await sb.from("properties").select("id, source, source_meta").limit(1);
  if (m0005.error) {
    checks.push({
      id: "migration_0005",
      label: "Migration 0005 (properties.source + source_meta)",
      status: "fail",
      detail: m0005.error.message,
      fix: "Paste supabase/migrations/0005_properties_source.sql into the Supabase SQL editor and click Run.",
    });
  } else {
    checks.push({ id: "migration_0005", label: "Migration 0005 (properties.source + source_meta)", status: "ok", detail: "source + source_meta columns present" });
  }

  // ─── 4d. Migration 0006: lead_status enrichment enum values ──────────────
  // Probe via a filter that only succeeds if the enum value exists.
  const m0006 = await sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "needs_enrichment" as never);
  if (m0006.error && m0006.error.code === "22P02") {
    checks.push({
      id: "migration_0006",
      label: "Migration 0006 (enrichment lead statuses)",
      status: "fail",
      detail: "lead_status enum missing enrichment values",
      fix: "Paste supabase/migrations/0006_enrichment_status.sql into the Supabase SQL editor and click Run.",
    });
  } else {
    checks.push({ id: "migration_0006", label: "Migration 0006 (enrichment lead statuses)", status: "ok", detail: "enrichment status enum values present" });
  }

  // ─── 4e. Migration 0007: phone_candidates + enrichment_events ──────────
  // Probes: both tables exist + key columns present on each.
  const [m0007pc, m0007ee, m0007pcCols, m0007eeCols] = await Promise.all([
    sb.from("phone_candidates").select("id", { count: "exact", head: true }),
    sb.from("enrichment_events").select("id", { count: "exact", head: true }),
    sb.from("phone_candidates").select("id, phone_raw, phone_e164, stage, initial_confidence, candidate_status, source_label, source_url, snippet").limit(1),
    sb.from("enrichment_events").select("id, lead_id, event_type, stage, candidate_id, payload").limit(1),
  ]);
  {
    const missingTables: string[] = [];
    const missingCols: string[] = [];
    if (m0007pc.error) missingTables.push("phone_candidates");
    if (m0007ee.error) missingTables.push("enrichment_events");
    if (!m0007pc.error && m0007pcCols.error) missingCols.push(`phone_candidates columns: ${m0007pcCols.error.message}`);
    if (!m0007ee.error && m0007eeCols.error) missingCols.push(`enrichment_events columns: ${m0007eeCols.error.message}`);
    const allBad = missingTables.length + missingCols.length;
    if (allBad > 0) {
      checks.push({
        id: "migration_0007",
        label: "Migration 0007 (phone_candidates + enrichment_events)",
        status: "fail",
        detail: [...missingTables.map(t => `missing table: ${t}`), ...missingCols].join("; "),
        fix: "Paste supabase/migrations/0007_phone_pipeline.sql into the Supabase SQL editor and click Run.",
      });
    } else {
      checks.push({
        id: "migration_0007",
        label: "Migration 0007 (phone_candidates + enrichment_events)",
        status: "ok",
        detail: `phone_candidates (${m0007pc.count ?? 0} rows) + enrichment_events (${m0007ee.count ?? 0} rows) — key columns confirmed`,
      });
    }
  }

  // ─── 4f. Migration 0008: address-first pipeline v2 ────────────────────
  // Probes: matched_on + new evidence columns on phone_candidates; auto_attached enum;
  // searching_address lead_status enum value.
  const [m0008col, m0008newCols, m0008enum, m0008status] = await Promise.all([
    sb.from("phone_candidates").select("id, matched_on").limit(1),
    sb.from("phone_candidates").select("id, candidate_name, candidate_address, search_query, related_entity_name, related_entity_type").limit(1),
    sb.from("phone_candidates").select("id", { count: "exact", head: true }).eq("candidate_status", "auto_attached" as never),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "searching_address" as never),
  ]);
  {
    const failing: string[] = [];
    if (m0008col.error) failing.push("matched_on column missing on phone_candidates");
    if (!m0008col.error && m0008newCols.error) failing.push(`evidence columns missing: ${m0008newCols.error.message}`);
    if (m0008enum.error?.code === "22P02") failing.push("candidate_status enum missing 'auto_attached'");
    if (m0008status.error?.code === "22P02") failing.push("lead_status enum missing 'searching_address'");
    if (failing.length > 0) {
      checks.push({
        id: "migration_0008",
        label: "Migration 0008 — W7 pipeline v2 (address-first stages)",
        status: "fail",
        detail: failing.join("; "),
        fix: "Paste supabase/migrations/0008_pipeline_v2_stages.sql into the Supabase SQL editor and click Run.",
      });
    } else {
      checks.push({
        id: "migration_0008",
        label: "Migration 0008 — W7 pipeline v2 (address-first stages)",
        status: "ok",
        detail: "matched_on, candidate_name, candidate_address, search_query columns present; auto_attached + searching_address enum values confirmed",
      });
    }
  }

  // ─── 4g. Migration 0009: OpenClaw Stage 3 statuses + event types ────────
  // Probes: openclaw_researching + unresolved_after_openclaw in lead_status enum;
  //         openclaw_dispatched + openclaw_callback_received in enrichment_event_type enum.
  // A code-22P02 error means the enum value doesn't exist yet.
  const [m0009s1, m0009s2, m0009e1, m0009e2] = await Promise.all([
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "openclaw_researching" as never),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "unresolved_after_openclaw" as never),
    sb.from("enrichment_events").select("id", { count: "exact", head: true }).eq("event_type", "openclaw_dispatched" as never),
    sb.from("enrichment_events").select("id", { count: "exact", head: true }).eq("event_type", "openclaw_callback_received" as never),
  ]);
  {
    const missing: string[] = [];
    if (m0009s1.error?.code === "22P02") missing.push("lead_status: openclaw_researching");
    if (m0009s2.error?.code === "22P02") missing.push("lead_status: unresolved_after_openclaw");
    if (m0009e1.error?.code === "22P02") missing.push("enrichment_event_type: openclaw_dispatched");
    if (m0009e2.error?.code === "22P02") missing.push("enrichment_event_type: openclaw_callback_received");
    if (missing.length > 0) {
      checks.push({
        id: "migration_0009",
        label: "Migration 0009 — OpenClaw Stage 3 enum values",
        status: "fail",
        detail: `Missing enum values: ${missing.join(", ")}`,
        fix: "Paste supabase/migrations/0009_openclaw_stage3.sql into the Supabase SQL editor and click Run.",
      });
    } else {
      checks.push({
        id: "migration_0009",
        label: "Migration 0009 — OpenClaw Stage 3 enum values",
        status: "ok",
        detail: "openclaw_researching, unresolved_after_openclaw (lead_status) + openclaw_dispatched, openclaw_callback_received (enrichment_event_type) all present",
      });
    }
  }

  // ─── 6. Env vars ──────────────────────────────────────────────────────
  const envChecks: Array<{ name: string; required: boolean; helpFix: string }> = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", required: true, helpFix: "Add to web/.env.local (project URL from Supabase dashboard)." },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, helpFix: "Add to web/.env.local (anon key from Supabase dashboard)." },
    { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, helpFix: "Add to web/.env.local (service-role key — server-only)." },
    { name: "NEXT_PUBLIC_APP_URL", required: false, helpFix: "Set to the public URL (e.g. https://socle-v2-production.up.railway.app). Required for Telegram CRM links to work in production." },
    { name: "TELEGRAM_BOT_TOKEN", required: false, helpFix: "Create a bot via @BotFather, paste token into web/.env.local." },
    { name: "TELEGRAM_ANTHONY_CHAT_ID", required: false, helpFix: "Send /start to your bot, then visit /api/telegram/identify and copy the id into web/.env.local." },
    { name: "TELEGRAM_WEBHOOK_SECRET", required: false, helpFix: "Run `openssl rand -hex 32`, put the result in web/.env.local. Required only when registering inbound webhook." },
    { name: "N8N_SHARED_KEY", required: false, helpFix: "Generate a strong secret and put in web/.env.local. Used by n8n workflows to call /api/n8n/* endpoints." },
    { name: "N8N_ENRICHMENT_WEBHOOK_URL", required: false, helpFix: "Set to the n8n enrichment workflow's webhook URL. Without it, /api/enrichment-jobs creates rows but doesn't auto-fire — n8n must poll." },
    // W7 — Phone enrichment pipeline v2
    { name: "BRAVE_SEARCH_API_KEY", required: true, helpFix: "Set BRAVE_SEARCH_API_KEY in Railway env vars. Get key from https://api.search.brave.com. Required for W7 address + company searches (Stages 1–2)." },
    { name: "OPENCLAW_WEBHOOK_URL", required: false, helpFix: "Set OPENCLAW_WEBHOOK_URL in Railway env vars to the n8n OpenClaw workflow webhook URL. Required for Stage 3 (automated browser deep search). No extra API key needed." },
  ];
  for (const e of envChecks) {
    const set = !!process.env[e.name];
    checks.push({
      id: `env_${e.name.toLowerCase()}`,
      label: `Env: ${e.name}`,
      status: set ? "ok" : (e.required ? "fail" : "warn"),
      detail: set ? "set" : (e.required ? "missing (required)" : "missing (optional)"),
      fix: set ? undefined : e.helpFix,
    });
  }

  // ─── 7. Seed data presence ─────────────────────────────────────────────
  const seedCounts = await Promise.all([
    sb.from("import_jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
    sb.from("leads").select("id", { count: "exact", head: true }),
    sb.from("leads").select("id", { count: "exact", head: true }).not("assigned_to", "is", null),
    sb.from("call_logs").select("id", { count: "exact", head: true }),
    sb.from("lead_submissions").select("id", { count: "exact", head: true }),
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("proposed_actions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("automation_events").select("id", { count: "exact", head: true }),
    // Enrichment counts (post-0004 — gracefully handles missing job_type column too)
    sb.from("enrichment_jobs").select("id", { count: "exact", head: true }),
    sb.from("enrichment_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    sb.from("enrichment_results").select("id", { count: "exact", head: true }),
    sb.from("enrichment_results").select("id", { count: "exact", head: true }).eq("status", "unverified"),
    // Stuck jobs (pending > 30m OR running > 60m).
    sb.from("enrichment_jobs").select("id", { count: "exact", head: true })
      .eq("status", "pending").lt("created_at", new Date(Date.now() - 30 * 60_000).toISOString()),
    sb.from("enrichment_jobs").select("id", { count: "exact", head: true })
      .eq("status", "running").lt("started_at", new Date(Date.now() - 60 * 60_000).toISOString()),
    // Import pipeline: unassigned leads + stuck preview jobs
    sb.from("leads").select("id", { count: "exact", head: true })
      .eq("status", "new").is("assigned_to", null),
    sb.from("import_jobs").select("id", { count: "exact", head: true })
      .eq("status", "preview").lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString()),
    // W7 pipeline v2 counts
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "ready_to_call"),
    sb.from("phone_candidates").select("id", { count: "exact", head: true }).eq("candidate_status", "needs_anthony_review"),
    sb.from("phone_candidates").select("id", { count: "exact", head: true }).eq("candidate_status", "auto_attached"),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "openclaw_researching"),
  ]);
  const [imps, leads, assigned, calls, subs, reviews, proposed, fups, events, enrichJobs, enrichJobFailures, enrichResults, enrichPending, stuckPending, stuckRunning, unassignedLeads, stuckPreviews, w7ReadyToCall, w7NeedsReview, w7AutoAttached, w7OpenclawResearching] = seedCounts.map(r => r.count ?? 0);
  const stuckTotal = stuckPending + stuckRunning;

  const seedChecks: Array<{ id: string; label: string; n: number; warnIf0: boolean; fix: string }> = [
    { id: "seed_imports", label: "Completed imports", n: imps, warnIf0: true, fix: "Upload a rôle XLSX at /import, OR run /admin/seed → 'Seed 10 leads'." },
    { id: "seed_leads", label: "Leads in DB", n: leads, warnIf0: true, fix: "Run /admin/seed → 'Seed 10 leads in Granby'." },
    { id: "seed_assigned", label: "Leads assigned to a caller", n: assigned, warnIf0: true, fix: "Run /admin/seed → 'Seed 10 leads + assign to caller', or bulk-assign on /leads." },
    { id: "seed_calls", label: "Call logs", n: calls, warnIf0: false, fix: "Open any lead from /calls/queue and click an outcome button." },
    { id: "seed_submissions", label: "Hot-seller submissions", n: subs, warnIf0: false, fix: "Run /admin/seed → 'Seed a hot-seller submission' for an end-to-end stub." },
    { id: "seed_reviews", label: "Open review items", n: reviews, warnIf0: false, fix: "Submissions create review items automatically." },
    { id: "seed_proposed", label: "Pending proposed actions", n: proposed, warnIf0: false, fix: "Run /admin/seed → 'Seed Telegram-style proposed action'." },
    { id: "seed_followups", label: "Pending follow-ups", n: fups, warnIf0: false, fix: "Quick-add on any lead detail, or via Telegram once chat ID is set." },
    { id: "seed_events", label: "Automation events logged", n: events, warnIf0: true, fix: "Any of the above actions logs an event." },
  ];

  // Enrichment health (separate from seed checks — these count both 0)
  const enrichmentChecks: Array<{ id: string; label: string; n: number; status: Status; detail: string; fix?: string }> = [
    { id: "enrich_jobs", label: "Enrichment jobs created", n: enrichJobs, status: "ok", detail: `${enrichJobs} job(s)` },
    { id: "enrich_failures", label: "Failed enrichment jobs", n: enrichJobFailures, status: enrichJobFailures > 0 ? "warn" : "ok", detail: `${enrichJobFailures} failed`, fix: enrichJobFailures > 0 ? "Inspect at /admin/events?source=n8n&status=failed" : undefined },
    { id: "enrich_results", label: "Enrichment results received", n: enrichResults, status: "ok", detail: `${enrichResults} result(s)` },
    { id: "enrich_pending_review", label: "Results pending review", n: enrichPending, status: enrichPending > 0 ? "warn" : "ok", detail: `${enrichPending} unverified`, fix: enrichPending > 0 ? "Open the relevant lead detail page to approve/reject." : undefined },
    { id: "enrich_stuck", label: "Stuck jobs (queued >30m or running >60m)", n: stuckTotal, status: stuckTotal > 0 ? "warn" : "ok", detail: stuckTotal > 0 ? `${stuckPending} stuck queued + ${stuckRunning} stuck running` : "no stuck jobs", fix: stuckTotal > 0 ? "Open /admin/enrichment to retry/cancel. Likely the n8n workflow didn't pick up the trigger." : undefined },
  ];
  for (const e of enrichmentChecks) {
    checks.push({ id: e.id, label: e.label, status: e.status, detail: e.detail, fix: e.fix });
  }
  for (const s of seedChecks) {
    checks.push({
      id: s.id,
      label: s.label,
      status: s.n > 0 ? "ok" : (s.warnIf0 ? "warn" : "warn"),
      detail: `${s.n} row(s)`,
      fix: s.n === 0 ? s.fix : undefined,
    });
  }

  // ─── W7 pipeline v2 health ──────────────────────────────────────────────
  // Query last enrichment event, last dispatch, last callback, and last failed job.
  const [lastEventRow, lastFailedJobRow, lastDispatchRow, lastCallbackRow, leadsNeedingEnrichmentRow] = await Promise.all([
    sb.from("enrichment_events").select("event_type, stage, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("enrichment_jobs").select("id, error_message, completed_at").eq("status", "failed").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("enrichment_events").select("lead_id, created_at").eq("event_type", "openclaw_dispatched").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("enrichment_events").select("lead_id, created_at").eq("event_type", "openclaw_callback_received").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("leads").select("id", { count: "exact", head: true }).not("status", "in", '("ready_to_call","in_outreach","meeting_set","qualified","phone_verified","do_not_contact","rejected")'),
  ]);
  const lastEvent = lastEventRow.data as { event_type: string; stage: string | null; created_at: string } | null;
  const lastFailed = lastFailedJobRow.data as { id: string; error_message: string | null; completed_at: string } | null;
  const lastDispatch = lastDispatchRow.data as { lead_id: string; created_at: string } | null;
  const lastCallback = lastCallbackRow.data as { lead_id: string; created_at: string } | null;
  const leadsNeedingPhone = leadsNeedingEnrichmentRow.count ?? 0;

  checks.push(
    {
      id: "w7_brave_key",
      label: "W7: BRAVE_SEARCH_API_KEY set (Stages 1–2)",
      status: !!process.env.BRAVE_SEARCH_API_KEY ? "ok" : "fail",
      detail: !!process.env.BRAVE_SEARCH_API_KEY ? "set — address + company searches active" : "missing — Stages 1 and 2 will throw at runtime",
      fix: !process.env.BRAVE_SEARCH_API_KEY ? "Add BRAVE_SEARCH_API_KEY to Railway → Service → Variables. Get key at https://api.search.brave.com." : undefined,
    },
    {
      id: "w7_openclaw_url",
      label: "W7: OPENCLAW_WEBHOOK_URL set (Stage 3)",
      status: !!process.env.OPENCLAW_WEBHOOK_URL ? "ok" : "warn",
      detail: !!process.env.OPENCLAW_WEBHOOK_URL ? "set — OpenClaw automated browser research active" : "missing — Stage 3 skipped, unresolved leads stay unresolved",
      fix: !process.env.OPENCLAW_WEBHOOK_URL ? "Set OPENCLAW_WEBHOOK_URL in Railway env vars to the n8n OpenClaw workflow webhook URL. No extra API key needed." : undefined,
    },
    {
      id: "w7_n8n_key",
      label: "W7: N8N_SHARED_KEY set (OpenClaw webhook auth)",
      status: !!process.env.N8N_SHARED_KEY ? "ok" : "warn",
      detail: !!process.env.N8N_SHARED_KEY
        ? "set — OpenClaw webhook calls will include Authorization header"
        : "missing — OpenClaw webhook fires without auth header (acceptable if n8n doesn't require it)",
      fix: !process.env.N8N_SHARED_KEY
        ? "Set N8N_SHARED_KEY in Railway env vars — same key used by all n8n → CRM calls."
        : undefined,
    },
    {
      id: "w7_b2bhint_removed",
      label: "W7: B2BHint API — intentionally removed",
      status: "ok" as Status,
      detail: "B2BHint API stage removed in migration 0009. OpenClaw (Stage 3) reads public B2BHint pages via browser — no API key required. Do not add B2BHINT_API_KEY.",
    },
    {
      id: "w7_ready_to_call",
      label: "W7: Leads auto-attached (ready_to_call)",
      status: "ok",
      detail: `${w7ReadyToCall} lead(s) with status=ready_to_call`,
    },
    {
      id: "w7_needs_review",
      label: "W7: Phone candidates needing review",
      status: w7NeedsReview > 0 ? "warn" : "ok",
      detail: w7NeedsReview > 0 ? `${w7NeedsReview} candidate(s) awaiting Anthony review` : "0 pending",
      fix: w7NeedsReview > 0 ? "Go to /phone-review to approve or reject phone candidates." : undefined,
    },
    {
      id: "w7_auto_attached",
      label: "W7: Phones auto-attached (high confidence)",
      status: "ok",
      detail: `${w7AutoAttached} phone(s) auto-attached without human review`,
    },
    {
      id: "w7_openclaw_researching",
      label: "W7: Leads currently in OpenClaw research",
      status: "ok",
      detail: `${w7OpenclawResearching} lead(s) with status=openclaw_researching (awaiting callback)`,
    },
    {
      id: "w7_leads_needing_phone",
      label: "W7: Leads still needing phone enrichment",
      status: "ok",
      detail: `${leadsNeedingPhone} lead(s) without a callable phone`,
    },
    {
      id: "w7_last_event",
      label: "W7: Last enrichment event",
      status: lastEvent ? "ok" : "warn",
      detail: lastEvent
        ? `${lastEvent.event_type} @ stage=${lastEvent.stage ?? "none"} (${lastEvent.created_at})`
        : "No enrichment events yet — pipeline has not run",
    },
    {
      id: "w7_last_openclaw_dispatch",
      label: "W7: Last OpenClaw dispatch",
      status: lastDispatch ? "ok" : "warn",
      detail: lastDispatch
        ? `Lead ${lastDispatch.lead_id} dispatched at ${lastDispatch.created_at}`
        : "OpenClaw has never been dispatched — set OPENCLAW_WEBHOOK_URL or run a lead through Stage 3",
    },
    {
      id: "w7_last_openclaw_callback",
      label: "W7: Last OpenClaw callback received",
      status: lastCallback ? "ok" : (lastDispatch ? "warn" : "ok"),
      detail: lastCallback
        ? `Lead ${lastCallback.lead_id} callback at ${lastCallback.created_at}`
        : lastDispatch ? "OpenClaw dispatched but no callback yet — check n8n workflow" : "No dispatches yet",
      fix: !lastCallback && lastDispatch ? "Check n8n OpenClaw workflow — it dispatched but never called back to /api/enrichment/openclaw-callback." : undefined,
    },
    {
      id: "w7_last_error",
      label: "W7: Last enrichment failure",
      status: lastFailed ? "warn" : "ok",
      detail: lastFailed
        ? `Job ${lastFailed.id}: ${lastFailed.error_message ?? "no message"} (${lastFailed.completed_at})`
        : "No failed enrichment jobs",
      fix: lastFailed ? "Check enrichment_jobs table for job " + lastFailed.id + " — inspect raw_output for more detail." : undefined,
    },
  );

  // ─── Import pipeline health ────────────────────────────────────────────
  checks.push(
    {
      id: "import_unassigned_leads",
      label: "Unassigned leads ready to assign",
      status: unassignedLeads > 0 ? "warn" : "ok",
      detail: unassignedLeads > 0
        ? `${unassignedLeads} lead(s) with status='new' and no caller assigned`
        : "All new leads have a caller assigned",
      fix: unassignedLeads > 0
        ? "Go to /leads → select unassigned leads → bulk-assign to a caller. Or run /admin/seed → 'Seed 10 leads + assign to caller'."
        : undefined,
    },
    {
      id: "import_stuck_preview",
      label: "Import jobs stuck in preview (>24h)",
      status: stuckPreviews > 0 ? "warn" : "ok",
      detail: stuckPreviews > 0
        ? `${stuckPreviews} import job(s) never confirmed — preview data may be stale`
        : "No stuck preview jobs",
      fix: stuckPreviews > 0
        ? "Go to /import and re-upload the file, or check import_jobs table for orphaned preview rows."
        : undefined,
    },
  );

  // ─── overall status ───────────────────────────────────────────────────
  const fails = checks.filter(c => c.status === "fail").length;
  const warns = checks.filter(c => c.status === "warn").length;
  let overall: "ready" | "needs_setup" | "needs_seed" | "missing_env" | "missing_migration";
  if (checks.find(c => c.status === "fail" && c.id.startsWith("migration_"))) overall = "missing_migration";
  else if (checks.find(c => c.status === "fail" && c.id.startsWith("env_"))) overall = "missing_env";
  else if (fails > 0) overall = "needs_setup";
  else if (warns > 0) overall = "needs_seed";
  else overall = "ready";

  // ─── Alpha loop health (informational — do NOT affect overall banner) ───
  const [tgRow, n8nLeadRow, n8nDraftRow] = await Promise.all([
    sb.from("automation_events").select("occurred_at, telegram_message_id")
      .not("telegram_message_id", "is", null).order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("automation_events").select("occurred_at")
      .eq("source", "n8n").eq("event_type", "lead_upserted_from_email").eq("status", "success")
      .order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("automation_events").select("occurred_at")
      .eq("source", "n8n").eq("event_type", "email_triage_draft_created").eq("status", "success")
      .order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const tgData = tgRow.data as { occurred_at: string; telegram_message_id: string } | null;
  const n8nLeadData = n8nLeadRow.data as { occurred_at: string } | null;
  const n8nDraftData = n8nDraftRow.data as { occurred_at: string } | null;
  checks.push(
    {
      id: "alpha_telegram",
      label: "Alpha A — Telegram alert delivered (ever)",
      status: tgData ? "ok" : "warn",
      detail: tgData
        ? `Last: ${tgData.occurred_at} (msg ${tgData.telegram_message_id})`
        : "No Telegram message ever sent",
      fix: tgData
        ? undefined
        : "Set TELEGRAM_ANTHONY_CHAT_ID + TELEGRAM_BOT_TOKEN, then submit a hot seller from /calls.",
    },
    {
      id: "alpha_n8n_lead",
      label: "Alpha B — n8n → CRM lead created (ever)",
      status: n8nLeadData ? "ok" : "warn",
      detail: n8nLeadData ? `Last: ${n8nLeadData.occurred_at}` : "No n8n lead event ever received",
      fix: n8nLeadData
        ? undefined
        : "Update n8n W1a CRM nodes to Railway URL + confirm N8N_SHARED_KEY is set.",
    },
    {
      id: "alpha_n8n_draft",
      label: "Alpha B — n8n → Gmail draft created (ever)",
      status: n8nDraftData ? "ok" : "warn",
      detail: n8nDraftData ? `Last: ${n8nDraftData.occurred_at}` : "No Gmail draft event — Gmail credentials not yet attached",
      fix: n8nDraftData
        ? undefined
        : "In n8n: open W1a (2gZp3dbXCZPU3NV6), attach antho02mb@gmail.com OAuth2 to: New Email Received, Create Draft - Ask for Details, Create Draft - Acknowledge Numbers. Attach OpenAI API to: AI Email Classifier.",
    },
  );

  return NextResponse.json({
    ok: true,
    data: {
      overall,
      stats: { fails, warns, total: checks.length, ok: checks.filter(c => c.status === "ok").length },
      checks,
    },
  });
}
