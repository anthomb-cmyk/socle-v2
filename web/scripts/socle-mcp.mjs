#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import * as z from "zod/v4";

const __filename = fileURLToPath(import.meta.url);
const WEB_DIR = path.resolve(path.dirname(__filename), "..");
const REPO_DIR = path.resolve(WEB_DIR, "..");

loadEnvFiles([
  path.join(REPO_DIR, ".env"),
  path.join(REPO_DIR, ".env.local"),
  path.join(WEB_DIR, ".env"),
  path.join(WEB_DIR, ".env.local"),
]);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_BASE_URL = stripTrailingSlash(
  process.env.SOCLE_APP_BASE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? "http://localhost:8985",
);
const DEFAULT_AUTH_EMAIL = process.env.SOCLE_MCP_AUTH_EMAIL ?? process.env.SOCLE_TEST_USER_EMAIL ?? "";
const WRITES_ENABLED = ["1", "true", "yes"].includes((process.env.SOCLE_MCP_ALLOW_WRITES ?? "").toLowerCase());
const CODEX_OPERATOR_KEY = process.env.SOCLE_CODEX_OPERATOR_KEY ?? "";
const CODEX_OPERATOR_ENABLED = ["1", "true", "yes"].includes((process.env.SOCLE_CODEX_OPERATOR_ENABLED ?? "").toLowerCase());
const DIRECT_MCP_WRITES_ENABLED = ["1", "true", "yes"].includes((process.env.SOCLE_MCP_DIRECT_WRITES_ENABLED ?? "").toLowerCase());

let supabase = null;

const server = new McpServer({
  name: "socle-crm",
  version: "0.2.0",
});

// ── HEALTH & AUTH ─────────────────────────────────────────────────────────────

server.registerTool(
  "socle_health",
  {
    title: "Socle MCP health",
    description: "Check MCP configuration and verify Supabase connectivity.",
    inputSchema: {},
  },
  withTool(async () => {
    const env = {
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasServiceRoleKey: Boolean(SERVICE_ROLE_KEY),
      appBaseUrl: APP_BASE_URL,
      hasDefaultAuthEmail: Boolean(DEFAULT_AUTH_EMAIL),
      hasCodexOperatorKey: Boolean(CODEX_OPERATOR_KEY),
      codexOperatorEnabled: CODEX_OPERATOR_ENABLED,
      writesEnabled: WRITES_ENABLED,
      directMcpWritesEnabled: DIRECT_MCP_WRITES_ENABLED,
      repoDir: REPO_DIR,
    };
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return { ok: false, env, nextStep: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in web/.env.local or in the MCP client env." };
    }
    const sb = getSupabase();
    const { count, error } = await sb.from("leads").select("id", { count: "planned", head: true });
    if (error) throw error;
    return { ok: true, env, sample: { leadsCount: count ?? 0 } };
  }),
);

server.registerTool(
  "create_login_link",
  {
    title: "Create Socle login link",
    description: "Generate a short-lived Supabase magic link so Claude/Codex can open Socle without being stuck at login.",
    inputSchema: {
      path: z.string().default("/").describe("Safe app path to open after login, e.g. /textos or /pipeline."),
      email: z.string().email().optional().describe("Optional auth user email. Defaults to SOCLE_MCP_AUTH_EMAIL."),
    },
  },
  withTool(async ({ path: nextPath = "/", email }) => {
    const sb = getSupabase();
    const authEmail = email || DEFAULT_AUTH_EMAIL;
    if (!authEmail) throw new Error("Missing auth email. Set SOCLE_MCP_AUTH_EMAIL or pass email.");
    const safePath = safeRelativePath(nextPath, "/");
    const redirectTo = `${APP_BASE_URL}/auth/callback?next=${encodeURIComponent(safePath)}`;
    const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email: authEmail, options: { redirectTo } });
    if (error) throw error;
    const actionLink = data?.properties?.action_link ?? data?.action_link ?? null;
    if (!actionLink) throw new Error("Supabase did not return an action_link.");
    return { ok: true, email: authEmail, appBaseUrl: APP_BASE_URL, nextPath: safePath, loginUrl: actionLink, warning: "Treat loginUrl as sensitive. It signs the browser into Socle as the selected user." };
  }),
);

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

server.registerTool(
  "get_dashboard_state",
  {
    title: "Get dashboard state",
    description: "Read dashboard-critical counts, urgent review items, recent imports and recent failed automation events.",
    inputSchema: {},
  },
  withTool(async () => {
    const sb = getSupabase();
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
    const dayAgo = new Date(now); dayAgo.setDate(dayAgo.getDate() - 1);
    const CALLABLE = ["new", "ready_to_call", "in_outreach", "no_answer", "phone_verified"];
    const [openReviews, urgentReviews, newLeads, leadsToCall, overdueFollowUps, todayFollowUps, recentImports, recentFailures, urgentItems, activeDeals] = await Promise.all([
      countRows("review_items", (q) => q.eq("status", "open")),
      countRows("review_items", (q) => q.eq("status", "open").eq("urgency", "urgent")),
      countRows("leads", (q) => q.eq("status", "new")),
      countRows("leads", (q) => q.in("status", CALLABLE).not("assigned_to", "is", null)),
      countRows("follow_ups", (q) => q.eq("status", "pending").lt("due_at", todayStart.toISOString())),
      countRows("follow_ups", (q) => q.eq("status", "pending").gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString())),
      sb.from("import_jobs").select("id,file_name,status,properties_created,leads_created,errors_count,created_at").order("created_at", { ascending: false }).limit(5),
      sb.from("automation_events").select("id,source,event_type,error_message,occurred_at").eq("status", "failed").gte("occurred_at", dayAgo.toISOString()).order("occurred_at", { ascending: false }).limit(8),
      sb.from("review_items").select("id,title,summary,urgency,created_at,lead_id").eq("status", "open").order("created_at", { ascending: false }).limit(8),
      sb.from("deals").select("id,title,stage,address,units,asking_price,temperature,updated_at").not("stage", "in", '("cloture","abandonne")').order("updated_at", { ascending: false }).limit(12),
    ]);
    assertOk(recentImports); assertOk(recentFailures); assertOk(urgentItems); assertOk(activeDeals);
    return { ok: true, counts: { openReviews, urgentReviews, newLeads, leadsToCall, overdueFollowUps, todayFollowUps }, urgentItems: urgentItems.data ?? [], recentImports: recentImports.data ?? [], recentFailures: recentFailures.data ?? [], activeDeals: activeDeals.data ?? [] };
  }),
);

// ── CRM READ TOOLS ────────────────────────────────────────────────────────────

server.registerTool(
  "search_leads",
  {
    title: "Search leads",
    description: "Search leads by name, phone, email or status.",
    inputSchema: {
      q: z.string().optional().describe("Free-text search against name, phone and email."),
      status: z.string().optional().describe("Filter by status, e.g. new, ready_to_call, in_outreach."),
      assigned_to: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
  },
  withTool(async ({ q, status, assigned_to, limit = 20 }) => {
    let query = getSupabase()
      .from("leads_view")
      .select("lead_id,status,assigned_to,created_at,updated_at,full_name,company_name,best_phone,address,city")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (assigned_to) query = query.eq("assigned_to", assigned_to);
    if (q?.trim()) {
      const term = `%${escapeLike(q.trim())}%`;
      query = query.or(`full_name.ilike.${term},company_name.ilike.${term},best_phone.ilike.${term},address.ilike.${term}`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, count: data?.length ?? 0, leads: (data ?? []).map((lead) => ({ id: lead.lead_id, ...lead })) };
  }),
);

server.registerTool(
  "get_lead",
  {
    title: "Get lead detail",
    description: "Read a full lead record with linked follow-ups and recent automation events.",
    inputSchema: { id: z.string().uuid() },
  },
  withTool(async ({ id }) => {
    const sb = getSupabase();
    const [lead, followUps, events] = await Promise.all([
      sb.from("leads").select("*").eq("id", id).single(),
      sb.from("follow_ups").select("*").eq("lead_id", id).order("due_at", { ascending: true }).limit(20),
      sb.from("automation_events").select("id,source,event_type,status,error_message,payload,occurred_at").eq("related_lead_id", id).order("occurred_at", { ascending: false }).limit(30),
    ]);
    assertOk(lead); assertOk(followUps, { allowMissingColumn: true }); assertOk(events, { allowMissingColumn: true });
    return { ok: true, lead: lead.data, followUps: followUps.data ?? [], events: events.data ?? [] };
  }),
);

server.registerTool(
  "list_follow_ups",
  {
    title: "List follow-ups",
    description: "List follow-ups filtered by status and time window.",
    inputSchema: {
      status: z.enum(["pending", "done", "cancelled"]).default("pending"),
      window: z.enum(["overdue", "today", "upcoming", "all"]).default("all"),
      limit: z.number().int().min(1).max(100).default(30),
    },
  },
  withTool(async ({ status = "pending", window = "all", limit = 30 }) => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
    let query = getSupabase()
      .from("follow_ups")
      .select("id,status,due_at,note,lead_id,contact_id,assigned_to,created_at")
      .eq("status", status)
      .order("due_at", { ascending: true })
      .limit(limit);
    if (window === "overdue") query = query.lt("due_at", todayStart.toISOString());
    else if (window === "today") query = query.gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString());
    else if (window === "upcoming") query = query.gte("due_at", todayEnd.toISOString());
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, count: data?.length ?? 0, followUps: data ?? [] };
  }),
);

server.registerTool(
  "get_contact",
  {
    title: "Get contact",
    description: "Read a contact record with linked leads and deals.",
    inputSchema: { id: z.string().uuid() },
  },
  withTool(async ({ id }) => {
    const sb = getSupabase();
    const [contact, leads, phones] = await Promise.all([
      sb.from("contacts").select("*").eq("id", id).single(),
      sb.from("leads_view").select("lead_id,status,updated_at,address,city,full_name,company_name,best_phone").eq("contact_id", id).order("updated_at", { ascending: false }).limit(20),
      sb.from("phones").select("id,e164,display,status,source,confidence,created_at").eq("contact_id", id).order("created_at", { ascending: false }).limit(20),
    ]);
    assertOk(contact); assertOk(leads); assertOk(phones);
    const name = contact.data?.full_name || contact.data?.company_name || "";
    let dealQuery = sb.from("deals").select("id,title,stage,updated_at,address,contact_name,contact_phone,contact_email").order("updated_at", { ascending: false }).limit(20);
    if (name) dealQuery = dealQuery.ilike("contact_name", `%${escapeLike(name)}%`);
    const deals = name ? await dealQuery : { data: [], error: null };
    assertOk(deals);
    return { ok: true, contact: contact.data, leads: leads.data ?? [], phones: phones.data ?? [], deals: deals.data ?? [] };
  }),
);

server.registerTool(
  "list_automation_events",
  {
    title: "List automation events",
    description: "Browse automation events with optional filters for source, type, or status.",
    inputSchema: {
      source: z.string().optional(),
      event_type: z.string().optional(),
      status: z.enum(["pending", "success", "failed", "queued"]).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    },
  },
  withTool(async ({ source, event_type, status, limit = 30 }) => {
    let query = getSupabase()
      .from("automation_events")
      .select("id,source,event_type,status,error_message,related_lead_id,related_contact_id,related_import_id,occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (source) query = query.eq("source", source);
    if (event_type) query = query.eq("event_type", event_type);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, count: data?.length ?? 0, events: data ?? [] };
  }),
);

server.registerTool(
  "stale_deals_report",
  {
    title: "Stale deals report",
    description: "List active pipeline deals with no activity for at least N days.",
    inputSchema: {
      days: z.number().int().min(1).max(365).default(14),
      limit: z.number().int().min(1).max(100).default(30),
    },
  },
  withTool(async ({ days = 14, limit = 30 }) => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const { data, error } = await getSupabase()
      .from("deals")
      .select("id,title,stage,address,units,asking_price,temperature,updated_at")
      .not("stage", "in", '("cloture","abandonne")')
      .lt("updated_at", cutoff.toISOString())
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return { ok: true, daysThreshold: days, count: data?.length ?? 0, staleDeals: data ?? [] };
  }),
);

// ── TEXTOS ────────────────────────────────────────────────────────────────────

server.registerTool(
  "list_textos",
  {
    title: "List Textos conversations",
    description: "List recent SMS conversations grouped by counterpart phone number.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(25) },
  },
  withTool(async ({ limit = 25 }) => {
    const events = await fetchSmsEvents(Math.min(limit * 12, 600));
    const conversations = buildSmsConversations(events).slice(0, limit);
    return { ok: true, count: conversations.length, conversations };
  }),
);

server.registerTool(
  "get_texto_thread",
  {
    title: "Get Textos thread",
    description: "Read one SMS thread by phone number.",
    inputSchema: {
      number: z.string().describe("Counterpart phone number, ideally E.164."),
      limit: z.number().int().min(1).max(200).default(80),
    },
  },
  withTool(async ({ number, limit = 80 }) => {
    const normalized = normalizePhone(number);
    if (!normalized) throw new Error("Could not normalize phone number.");
    const events = await fetchSmsEvents(800);
    const messages = events
      .filter((e) => counterpartNumber(e) === normalized)
      .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
      .slice(-limit)
      .map(toSmsMessage);
    return { ok: true, number: normalized, count: messages.length, messages };
  }),
);

// ── DEALS ─────────────────────────────────────────────────────────────────────

server.registerTool(
  "list_deals",
  {
    title: "List pipeline deals",
    description: "List pipeline deals by stage, recency or search text.",
    inputSchema: {
      stage: z.enum(["prospection", "analyse", "offre", "due_diligence", "financement", "cloture", "abandonne"]).optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(30),
    },
  },
  withTool(async ({ stage, search, limit = 30 }) => {
    let query = getSupabase()
      .from("deals")
      .select("id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,contact_phone,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (stage) query = query.eq("stage", stage);
    if (search?.trim()) {
      const term = `%${escapeLike(search.trim())}%`;
      query = query.or(`title.ilike.${term},address.ilike.${term},contact_name.ilike.${term}`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, count: data?.length ?? 0, deals: data ?? [] };
  }),
);

server.registerTool(
  "get_deal",
  {
    title: "Get deal dossier",
    description: "Read a full pipeline deal dossier with documents and recent automation events.",
    inputSchema: { id: z.string().uuid() },
  },
  withTool(async ({ id }) => {
    const sb = getSupabase();
    const [deal, docs, events] = await Promise.all([
      sb.from("deals").select("*").eq("id", id).single(),
      sb.from("deal_documents").select("*").eq("deal_id", id).order("created_at", { ascending: false }).limit(20),
      sb.from("automation_events").select("id,source,event_type,status,error_message,payload,result,occurred_at").filter("payload->>dealId", "eq", id).order("occurred_at", { ascending: false }).limit(30),
    ]);
    assertOk(deal); assertOk(docs); assertOk(events, { allowMissingColumn: true });
    return { ok: true, deal: deal.data, documents: docs.data ?? [], events: events.data ?? [] };
  }),
);

// ── REVIEW ITEMS ──────────────────────────────────────────────────────────────

server.registerTool(
  "list_review_items",
  {
    title: "List review items",
    description: "List items in the Revue queue.",
    inputSchema: {
      status: z.enum(["open", "accepted", "archived", "rejected"]).default("open"),
      urgency: z.enum(["urgent", "high", "normal", "low"]).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    },
  },
  withTool(async ({ status = "open", urgency, limit = 30 }) => {
    let query = getSupabase()
      .from("review_items")
      .select("id,status,urgency,title,summary,lead_id,contact_id,property_id,created_at,resolved_at")
      .eq("status", status)
      .order(status === "open" ? "created_at" : "resolved_at", { ascending: false })
      .limit(limit);
    if (urgency) query = query.eq("urgency", urgency);
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, count: data?.length ?? 0, items: data ?? [] };
  }),
);

// ── CRM WRITE TOOLS ───────────────────────────────────────────────────────────

server.registerTool(
  "get_phone_enrichment_session",
  {
    title: "Get phone enrichment session",
    description: "Read the same import-scoped phone enrichment session summary used by the Socle UI.",
    inputSchema: {
      importJobId: z.string().uuid(),
      sessionToken: z.string().optional(),
    },
  },
  withTool(async ({ importJobId, sessionToken }) => {
    return callCodexOperatorEndpoint(`/api/phone-enrichment/sessions/${importJobId}`, { sessionToken });
  }),
);

server.registerTool(
  "begin_phone_enrichment_session",
  {
    title: "Begin phone enrichment Codex session",
    description: "Issue a short-lived Codex session token scoped to one import. Requires confirmation during rollout.",
    inputSchema: {
      importJobId: z.string().uuid(),
      expiresInMinutes: z.number().int().min(15).max(240).default(60),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ importJobId, expiresInMinutes = 60, confirm }) => {
    requireGovernedWrites(confirm);
    return callCodexOperatorEndpoint(`/api/phone-enrichment/sessions/${importJobId}/begin`, {
      method: "POST",
      body: { expiresInMinutes },
    });
  }),
);

server.registerTool(
  "codex_action",
  {
    title: "Run governed Codex action",
    description: "Run a phone-enrichment Codex action through the governed Socle admin endpoint. Requires SOCLE_MCP_ALLOW_WRITES=true, SOCLE_CODEX_OPERATOR_KEY, and confirmation.",
    inputSchema: {
      importJobId: z.string().uuid(),
      action_type: z.enum(["start_enrichment", "retry_enrichment_job", "mark_stale_jobs_failed", "propose_review_decisions", "apply_trusted_review_decisions"]),
      payload: z.object({}).catchall(z.unknown()).default({}),
      idempotency_key: z.string().min(1).max(200).optional(),
      dry_run: z.boolean().default(false),
      sessionToken: z.string().optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ importJobId, action_type, payload = {}, idempotency_key, dry_run = false, sessionToken, confirm }) => {
    requireGovernedWrites(confirm);
    return callCodexOperatorEndpoint(`/api/phone-enrichment/sessions/${importJobId}/codex-action`, {
      method: "POST",
      body: { action_type, payload, idempotency_key, dry_run },
      sessionToken,
    });
  }),
);

server.registerTool(
  "run_phone_enrichment_ai_pass",
  {
    title: "Run phone enrichment AI second pass",
    description: "Run the measured AI second pass through Socle's governed endpoint. Requires confirmation.",
    inputSchema: {
      importJobId: z.string().uuid(),
      leadIds: z.array(z.string().uuid()).max(50).optional(),
      maxLeads: z.number().int().min(1).max(50).default(10),
      idempotency_key: z.string().min(1).max(200).optional(),
      dry_run: z.boolean().default(false),
      sessionToken: z.string().optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ importJobId, leadIds, maxLeads = 10, idempotency_key, dry_run = false, sessionToken, confirm }) => {
    requireGovernedWrites(confirm);
    return callCodexOperatorEndpoint(`/api/phone-enrichment/sessions/${importJobId}/ai-pass`, {
      method: "POST",
      body: { leadIds, maxLeads, idempotency_key, dry_run },
      sessionToken,
    });
  }),
);

server.registerTool(
  "undo_codex_action",
  {
    title: "Undo reversible Codex action",
    description: "Undo a reversible Codex phone-enrichment action through Socle's governed endpoint. Requires confirmation.",
    inputSchema: {
      importJobId: z.string().uuid(),
      actionId: z.string().uuid(),
      sessionToken: z.string().optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ importJobId, actionId, sessionToken, confirm }) => {
    requireGovernedWrites(confirm);
    return callCodexOperatorEndpoint(`/api/phone-enrichment/sessions/${importJobId}/codex-action/undo`, {
      method: "POST",
      body: { action_id: actionId },
      sessionToken,
    });
  }),
);

server.registerTool(
  "get_phone_enrichment_budget_status",
  {
    title: "Get phone enrichment budget status",
    description: "Read AI budget status for one phone enrichment import session.",
    inputSchema: {
      importJobId: z.string().uuid(),
      sessionToken: z.string().optional(),
    },
  },
  withTool(async ({ importJobId, sessionToken }) => {
    const json = await callCodexOperatorEndpoint(`/api/phone-enrichment/sessions/${importJobId}`, { sessionToken });
    return { ok: true, budget: json?.data?.budget ?? null, importJobId };
  }),
);

server.registerTool(
  "calibrate_phone_enrichment_trust",
  {
    title: "Calibrate phone enrichment trust",
    description: "Recompute Codex trust thresholds from Anthony's reviewed phone candidates. Requires confirmation.",
    inputSchema: {
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ confirm }) => {
    requireGovernedWrites(confirm);
    return callCodexOperatorEndpoint("/api/phone-enrichment/trust/calibrate", {
      method: "POST",
      body: {},
    });
  }),
);

server.registerTool(
  "send_texto",
  {
    title: "Send texto / SMS reply",
    description: "Queue an outbound SMS. Inserts a pending sms_send_requested event the automation pipeline will process. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      to: z.string().describe("Recipient phone number (E.164 preferred)."),
      body: z.string().min(1).max(1600),
      leadId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      dealId: z.string().uuid().optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ to, body, leadId, contactId, dealId, confirm }) => {
    requireWrites(confirm);
    const { data, error } = await getSupabase()
      .from("automation_events")
      .insert({ source: "socle_mcp", event_type: "sms_send_requested", status: "pending", related_lead_id: leadId ?? null, related_contact_id: contactId ?? null, payload: { to: normalizePhone(to) || to, body, dealId: dealId ?? null, inserted_by: "socle-mcp" }, occurred_at: new Date().toISOString() })
      .select("id,event_type,status,occurred_at,payload")
      .single();
    if (error) throw error;
    return { ok: true, note: "Queued for sending — the automation pipeline will process this event.", event: data };
  }),
);

server.registerTool(
  "seed_test_sms",
  {
    title: "Seed test SMS event",
    description: "Insert a synthetic SMS automation_event for Textos UI testing. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      direction: z.enum(["inbound", "outbound"]).default("inbound"),
      from: z.string(),
      to: z.string(),
      body: z.string().min(1).max(1000),
      leadId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      dealId: z.string().uuid().optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ direction = "inbound", from, to, body, leadId, contactId, dealId, confirm }) => {
    requireWrites(confirm);
    const eventType = direction === "inbound" ? "sms_received" : "sms_sent";
    const { data, error } = await getSupabase()
      .from("automation_events")
      .insert({ source: "socle_mcp", event_type: eventType, status: "success", related_lead_id: leadId ?? null, related_contact_id: contactId ?? null, payload: { from: normalizePhone(from) || from, to: normalizePhone(to) || to, body, dealId: dealId ?? null, inserted_by: "socle-mcp" }, occurred_at: new Date().toISOString() })
      .select("id,event_type,occurred_at,payload")
      .single();
    if (error) throw error;
    return { ok: true, event: data };
  }),
);

server.registerTool(
  "create_follow_up",
  {
    title: "Create follow-up",
    description: "Schedule a follow-up reminder for a lead or contact. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      due_at: z.string().describe("ISO 8601 datetime."),
      note: z.string().max(500).optional(),
      lead_id: z.string().uuid().optional(),
      contact_id: z.string().uuid().optional(),
      assigned_to: z.string().uuid().optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ due_at, note, lead_id, contact_id, assigned_to, confirm }) => {
    requireWrites(confirm);
    if (!lead_id && !contact_id) throw new Error("Provide at least one of lead_id or contact_id.");
    const { data, error } = await getSupabase()
      .from("follow_ups")
      .insert({ due_at, note: note ?? null, lead_id: lead_id ?? null, contact_id: contact_id ?? null, assigned_to: assigned_to ?? null, status: "pending", created_at: new Date().toISOString() })
      .select("id,status,due_at,note,lead_id,contact_id,assigned_to")
      .single();
    if (error) throw error;
    return { ok: true, followUp: data };
  }),
);

server.registerTool(
  "complete_follow_up",
  {
    title: "Complete follow-up",
    description: "Mark a pending follow-up as done. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      id: z.string().uuid(),
      note: z.string().max(500).optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ id, note, confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const update = { status: "done", updated_at: new Date().toISOString() };
    if (note?.trim()) {
      const { data: existing, error: readErr } = await sb.from("follow_ups").select("note").eq("id", id).single();
      if (readErr) throw readErr;
      const previous = typeof existing?.note === "string" ? existing.note : "";
      const stamped = `[${new Date().toISOString()}] done via MCP: ${note.trim()}`;
      update.note = previous ? `${previous}\n\n${stamped}` : stamped;
    }
    const { data, error } = await sb
      .from("follow_ups")
      .update(update)
      .eq("id", id)
      .eq("status", "pending")
      .select("id,status,due_at,note,updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Follow-up not found or already completed.");
    return { ok: true, followUp: data };
  }),
);

server.registerTool(
  "update_lead_status",
  {
    title: "Update lead status",
    description: "Change a lead's status. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      id: z.string().uuid(),
      status: z.enum(["new", "ready_to_call", "in_outreach", "no_answer", "phone_verified", "converted", "disqualified", "do_not_contact"]),
      note: z.string().max(500).optional().describe("Optional reason — logged as an automation event."),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ id, status, note, confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const now = new Date().toISOString();
    if (note?.trim()) {
      await sb.from("automation_events").insert({ source: "socle_mcp", event_type: "lead_status_changed", status: "success", related_lead_id: id, payload: { newStatus: status, note: note.trim(), changedBy: "socle-mcp" }, occurred_at: now });
    }
    const { data, error } = await sb.from("leads").update({ status, updated_at: now }).eq("id", id).select("id,status,updated_at").single();
    if (error) throw error;
    return { ok: true, lead: data };
  }),
);

server.registerTool(
  "update_deal_stage",
  {
    title: "Update deal stage",
    description: "Move a pipeline deal to another stage. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      id: z.string().uuid(),
      stage: z.enum(["prospection", "analyse", "offre", "due_diligence", "financement", "cloture", "abandonne"]),
      activity: z.string().max(500).optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ id, stage, activity, confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const update = { stage, updated_at: new Date().toISOString() };
    if (activity?.trim()) {
      const { data, error } = await sb.from("deals").select("activities").eq("id", id).single();
      if (error) throw error;
      const prev = Array.isArray(data?.activities) ? data.activities : [];
      update.activities = [{ id: randomUUID(), text: activity.trim(), time: new Date().toISOString(), by: "socle-mcp" }, ...prev];
    }
    const { data, error } = await sb.from("deals").update(update).eq("id", id).select("id,title,stage,updated_at").single();
    if (error) throw error;
    return { ok: true, deal: data };
  }),
);

server.registerTool(
  "update_deal_fields",
  {
    title: "Update deal fields",
    description: "Edit deal metadata: price, units, temperature, contact info, priority. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      id: z.string().uuid(),
      title: z.string().max(200).optional(),
      address: z.string().max(500).optional(),
      units: z.number().int().min(0).optional(),
      asking_price: z.number().min(0).optional(),
      offer_price: z.number().min(0).optional(),
      temperature: z.enum(["hot", "warm", "cold"]).optional(),
      priority: z.enum(["high", "normal", "low"]).optional(),
      contact_name: z.string().max(200).optional(),
      contact_phone: z.string().max(50).optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ id, confirm, ...fields }) => {
    requireWrites(confirm);
    const update = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (Object.keys(update).length === 0) throw new Error("No fields to update.");
    update.updated_at = new Date().toISOString();
    const { data, error } = await getSupabase().from("deals").update(update).eq("id", id).select("id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,contact_phone,updated_at").single();
    if (error) throw error;
    return { ok: true, deal: data };
  }),
);

server.registerTool(
  "add_deal_note",
  {
    title: "Add deal note",
    description: "Append or replace deal, seller or AI analysis notes. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      id: z.string().uuid(),
      field: z.enum(["notes_deal", "notes_vendeur", "ai_analysis"]),
      note: z.string().min(1).max(5000),
      mode: z.enum(["append", "replace"]).default("append"),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ id, field, note, mode = "append", confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const { data: existing, error: readError } = await sb.from("deals").select(field).eq("id", id).single();
    if (readError) throw readError;
    const previous = typeof existing?.[field] === "string" ? existing[field] : "";
    const next = mode === "replace" ? note : [previous, `[${new Date().toISOString()}] MCP\n${note}`].filter(Boolean).join("\n\n");
    const { data, error } = await sb.from("deals").update({ [field]: next, updated_at: new Date().toISOString() }).eq("id", id).select(`id,title,${field},updated_at`).single();
    if (error) throw error;
    return { ok: true, deal: data };
  }),
);

server.registerTool(
  "create_deal",
  {
    title: "Create pipeline deal",
    description: "Create a new deal dossier. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      title: z.string().min(1).max(200),
      address: z.string().max(500).optional(),
      stage: z.enum(["prospection", "analyse", "offre", "due_diligence", "financement", "cloture", "abandonne"]).default("prospection"),
      units: z.number().int().min(0).optional(),
      asking_price: z.number().min(0).optional(),
      temperature: z.enum(["hot", "warm", "cold"]).default("cold"),
      contact_name: z.string().max(200).optional(),
      contact_phone: z.string().max(50).optional(),
      lead_id: z.string().uuid().optional(),
      notes_deal: z.string().max(5000).optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ confirm, ...fields }) => {
    requireWrites(confirm);
    const now = new Date().toISOString();
    const { data, error } = await getSupabase().from("deals").insert({ ...fields, created_at: now, updated_at: now }).select("id,title,stage,address,units,asking_price,temperature,contact_name,created_at").single();
    if (error) throw error;
    return { ok: true, deal: data };
  }),
);

server.registerTool(
  "resolve_review_item",
  {
    title: "Defer or reject review item",
    description: "Defer or reject an open review item. Approval should still be done in the app. Requires writes and confirmation.",
    inputSchema: {
      id: z.string().uuid(),
      action: z.enum(["defer", "reject"]),
      note: z.string().max(500).optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ id, action, note, confirm }) => {
    requireWrites(confirm);
    const now = new Date().toISOString();
    const status = action === "defer" ? "archived" : "rejected";
    const resolutionNote = note?.trim() || (action === "defer" ? "deferred by socle-mcp" : "rejected by socle-mcp");
    const { data, error } = await getSupabase()
      .from("review_items")
      .update({ status, resolved_at: now, resolution_note: resolutionNote })
      .eq("id", id)
      .eq("status", "open")
      .select("id,status,title,lead_id,resolved_at,resolution_note")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Review item not found or already resolved.");
    return { ok: true, action, item: data };
  }),
);

// ── DEV READ TOOLS ────────────────────────────────────────────────────────────
//
// run_query, describe_table, list_rls_policies, find_duplicate_leads,
// audit_statuses, and orphan_check require a one-time helper function.
// Run this once in your Supabase SQL editor:
//
//   create or replace function public.mcp_run_query(query text)
//   returns json language plpgsql security definer as $$
//   declare result json;
//   begin
//     execute 'select json_agg(t) from (' || query || ') t' into result;
//     return coalesce(result, '[]'::json);
//   end; $$;

server.registerTool(
  "run_query",
  {
    title: "Run read-only SQL query",
    description: "Execute a SELECT query against Supabase. Requires the mcp_run_query() helper — see source file comment for one-time setup SQL.",
    inputSchema: {
      query: z.string().min(1).describe("A SELECT statement only. No INSERT/UPDATE/DELETE/DDL."),
      limit_hint: z.number().int().min(1).max(500).default(100).describe("Auto-appended LIMIT if query has none."),
    },
  },
  withTool(async ({ query, limit_hint = 100 }) => {
    const cleaned = query.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const upper = cleaned.toUpperCase();
    if (!upper.startsWith("SELECT")) throw new Error("Only SELECT statements are allowed.");
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|EXECUTE|CALL|DO|PERFORM)\b/;
    if (forbidden.test(upper)) throw new Error("Query contains a forbidden keyword.");
    const sql = upper.includes(" LIMIT ") ? cleaned : `${cleaned} LIMIT ${limit_hint}`;
    const { data, error } = await getSupabase().rpc("mcp_run_query", { query: sql });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    return { ok: true, count: rows.length, rows };
  }),
);

server.registerTool(
  "describe_table",
  {
    title: "Describe table schema",
    description: "Return column names, types, nullable and defaults for a table via information_schema. Requires mcp_run_query() helper.",
    inputSchema: { table: z.string().min(1) },
  },
  withTool(async ({ table }) => {
    const safe = table.replace(/'/g, "''");
    const { data, error } = await getSupabase().rpc("mcp_run_query", {
      query: `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${safe}' ORDER BY ordinal_position`,
    });
    if (error) throw error;
    const columns = Array.isArray(data) ? data : [];
    if (columns.length === 0) return { ok: true, table, note: "No columns found — table may not exist or may not be in the public schema.", columns: [] };
    return { ok: true, table, columns };
  }),
);

server.registerTool(
  "list_rls_policies",
  {
    title: "List RLS policies",
    description: "Show Row Level Security policies for a table (or all tables). Requires mcp_run_query() helper.",
    inputSchema: { table: z.string().optional() },
  },
  withTool(async ({ table }) => {
    const where = table ? `WHERE tablename = '${table.replace(/'/g, "''")}'` : "";
    const { data, error } = await getSupabase().rpc("mcp_run_query", {
      query: `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies ${where} ORDER BY tablename, policyname`,
    });
    if (error) throw error;
    const policies = Array.isArray(data) ? data : [];
    return { ok: true, count: policies.length, policies };
  }),
);

server.registerTool(
  "tail_errors",
  {
    title: "Tail automation errors",
    description: "Return the most recent failed automation events — like tail -f for your event bus.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20),
      source: z.string().optional(),
    },
  },
  withTool(async ({ limit = 20, source }) => {
    let query = getSupabase()
      .from("automation_events")
      .select("id,source,event_type,error_message,payload,related_lead_id,related_contact_id,related_import_id,occurred_at")
      .eq("status", "failed")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (source) query = query.eq("source", source);
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, count: data?.length ?? 0, errors: data ?? [] };
  }),
);

server.registerTool(
  "get_automation_event",
  {
    title: "Get automation event detail",
    description: "Fetch the full record for a single automation event including raw payload and result.",
    inputSchema: { id: z.string().uuid() },
  },
  withTool(async ({ id }) => {
    const { data, error } = await getSupabase().from("automation_events").select("*").eq("id", id).single();
    if (error) throw error;
    return { ok: true, event: data };
  }),
);

server.registerTool(
  "get_import_job",
  {
    title: "Get import job detail",
    description: "Read a full import job record plus up to 100 validation errors from import_errors.",
    inputSchema: { id: z.string().uuid() },
  },
  withTool(async ({ id }) => {
    const sb = getSupabase();
    const [job, errors] = await Promise.all([
      sb.from("import_jobs").select("*").eq("id", id).single(),
      sb.from("import_row_audits").select("row_number,outcome,blocking,warnings,owners").eq("import_job_id", id).order("row_number").limit(100),
    ]);
    assertOk(job); assertOk(errors);
    return { ok: true, job: job.data, errors: errors.data ?? [] };
  }),
);

server.registerTool(
  "list_import_errors",
  {
    title: "List import validation errors",
    description: "Page through per-row validation errors for a specific import job.",
    inputSchema: {
      job_id: z.string().uuid(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    },
  },
  withTool(async ({ job_id, limit = 50, offset = 0 }) => {
    const { data, error } = await getSupabase()
      .from("import_row_audits")
      .select("row_number,outcome,blocking,warnings,owners")
      .eq("import_job_id", job_id)
      .order("row_number")
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return { ok: true, job_id, count: data?.length ?? 0, errors: data ?? [] };
  }),
);

server.registerTool(
  "find_duplicate_leads",
  {
    title: "Find duplicate leads",
    description: "Identify leads sharing the same phone or email. Requires mcp_run_query() helper.",
    inputSchema: {
      field: z.enum(["phone", "email"]).default("phone"),
      limit: z.number().int().min(1).max(50).default(20),
    },
  },
  withTool(async ({ field = "phone", limit = 20 }) => {
    const query = field === "phone"
      ? `SELECT best_phone as phone, count(*)::int as occurrences, array_agg(lead_id::text) as lead_ids FROM leads_view WHERE best_phone IS NOT NULL AND best_phone <> '' GROUP BY best_phone HAVING count(*) > 1 ORDER BY occurrences DESC LIMIT ${limit}`
      : `SELECT c.primary_email as email, count(l.id)::int as occurrences, array_agg(l.id::text) as lead_ids FROM contacts c JOIN leads l ON l.contact_id = c.id WHERE c.primary_email IS NOT NULL AND c.primary_email <> '' GROUP BY c.primary_email HAVING count(l.id) > 1 ORDER BY occurrences DESC LIMIT ${limit}`;
    const { data, error } = await getSupabase().rpc("mcp_run_query", {
      query,
    });
    if (error) throw error;
    const dupes = Array.isArray(data) ? data : [];
    return { ok: true, field, count: dupes.length, duplicates: dupes };
  }),
);

server.registerTool(
  "audit_statuses",
  {
    title: "Audit status distributions",
    description: "Count breakdown of leads by status and deals by stage. Requires mcp_run_query() helper.",
    inputSchema: {},
  },
  withTool(async () => {
    const sb = getSupabase();
    const [byStatus, byStage] = await Promise.all([
      sb.rpc("mcp_run_query", { query: "SELECT status, count(*)::int as count FROM leads GROUP BY status ORDER BY count DESC" }),
      sb.rpc("mcp_run_query", { query: "SELECT stage, count(*)::int as count FROM deals GROUP BY stage ORDER BY count DESC" }),
    ]);
    if (byStatus.error) throw byStatus.error;
    if (byStage.error) throw byStage.error;
    return { ok: true, leadsByStatus: Array.isArray(byStatus.data) ? byStatus.data : [], dealsByStage: Array.isArray(byStage.data) ? byStage.data : [] };
  }),
);

server.registerTool(
  "orphan_check",
  {
    title: "Orphan / data integrity check",
    description: "Find common data integrity issues: active deals without contacts, leads without phones, orphaned follow-ups. Requires mcp_run_query() helper.",
    inputSchema: {},
  },
  withTool(async () => {
    const sb = getSupabase();
    const checks = {
      active_deals_no_contact: "SELECT count(*)::int as count FROM deals WHERE contact_name IS NULL AND contact_phone IS NULL AND contact_email IS NULL AND stage NOT IN ('cloture','abandonne')",
      leads_no_phone: "SELECT count(*)::int as count FROM leads l WHERE status NOT IN ('disqualified','do_not_contact') AND NOT EXISTS (SELECT 1 FROM phones ph WHERE ph.contact_id = l.contact_id AND ph.status IN ('unverified','valid'))",
      follow_ups_no_parent: "SELECT count(*)::int as count FROM follow_ups WHERE lead_id IS NULL AND contact_id IS NULL AND status = 'pending'",
      open_reviews_no_lead: "SELECT count(*)::int as count FROM review_items WHERE lead_id IS NULL AND status = 'open'",
    };
    const results = {};
    for (const [key, query] of Object.entries(checks)) {
      const { data, error } = await sb.rpc("mcp_run_query", { query });
      results[key] = error ? { error: error.message } : (Array.isArray(data) && data[0] ? Number(data[0].count) : 0);
    }
    return { ok: true, ...results };
  }),
);

server.registerTool(
  "check_env",
  {
    title: "Check environment configuration",
    description: "Verify all expected env vars are present in the MCP process. Never returns values — presence flags only.",
    inputSchema: {},
  },
  withTool(async () => {
    const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SOCLE_APP_BASE_URL", "SOCLE_MCP_AUTH_EMAIL", "SOCLE_MCP_ALLOW_WRITES"];
    const optional = ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL", "SOCLE_TEST_USER_EMAIL", "SOCLE_CODEX_OPERATOR_KEY"];
    const flag = (keys) => Object.fromEntries(keys.map((k) => [k, Boolean(process.env[k])]));
    return { ok: true, required: flag(required), optional: flag(optional), allRequiredPresent: required.every((k) => Boolean(process.env[k])), writesEnabled: WRITES_ENABLED };
  }),
);

server.registerTool(
  "get_supabase_stats",
  {
    title: "Get Supabase table stats",
    description: "Row counts for all key tables — a quick data health snapshot.",
    inputSchema: {},
  },
  withTool(async () => {
    const tables = ["leads", "contacts", "deals", "deal_documents", "follow_ups", "review_items", "import_jobs", "automation_events"];
    const counts = await Promise.all(tables.map(async (t) => { try { return [t, await countRows(t)]; } catch { return [t, null]; } }));
    return { ok: true, stats: Object.fromEntries(counts) };
  }),
);

// ── DEV WRITE TOOLS ───────────────────────────────────────────────────────────

server.registerTool(
  "replay_automation_event",
  {
    title: "Replay failed automation event",
    description: "Re-insert a failed event as a new pending event so the pipeline picks it up again. Requires writes and confirmation.",
    inputSchema: {
      id: z.string().uuid(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ id, confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const { data: original, error: readError } = await sb.from("automation_events").select("*").eq("id", id).single();
    if (readError) throw readError;
    if (!original) throw new Error("Event not found.");
    const { id: _id, occurred_at: _oc, status: _st, error_message: _em, result: _re, ...rest } = original;
    const { data, error } = await sb
      .from("automation_events")
      .insert({ ...rest, status: "pending", error_message: null, result: null, occurred_at: new Date().toISOString(), payload: { ...rest.payload, replayed_from: id, replayed_by: "socle-mcp" } })
      .select("id,event_type,status,occurred_at")
      .single();
    if (error) throw error;
    return { ok: true, note: "Replayed as a new pending event.", originalId: id, newEvent: data };
  }),
);

server.registerTool(
  "seed_test_lead",
  {
    title: "Seed test lead",
    description: "Insert a synthetic lead tagged source=socle_mcp_seed for easy cleanup via reset_test_seeds. Requires writes and confirmation.",
    inputSchema: {
      full_name: z.string().default("Test Lead MCP"),
      phone: z.string().default("+15550001234"),
      email: z.string().email().optional(),
      status: z.enum(["new", "ready_to_call", "in_outreach"]).default("new"),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ full_name, phone, email, status, confirm }) => {
    requireWrites(confirm);
    const now = new Date().toISOString();
    const { data, error } = await getSupabase()
      .from("leads")
      .insert({ full_name, phone: normalizePhone(phone) || phone, email: email ?? null, status, source: "socle_mcp_seed", created_at: now, updated_at: now })
      .select("id,full_name,phone,status,created_at")
      .single();
    if (error) throw error;
    return { ok: true, lead: data };
  }),
);

server.registerTool(
  "seed_test_deal",
  {
    title: "Seed test deal",
    description: "Insert a synthetic deal tagged source=socle_mcp_seed. Requires writes and confirmation.",
    inputSchema: {
      title: z.string().default("Test Deal MCP"),
      address: z.string().default("123 Rue de Test, Montréal, QC"),
      stage: z.enum(["prospection", "analyse", "offre", "due_diligence"]).default("prospection"),
      units: z.number().int().min(0).default(6),
      asking_price: z.number().min(0).default(500000),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ title, address, stage, units, asking_price, confirm }) => {
    requireWrites(confirm);
    const now = new Date().toISOString();
    const { data, error } = await getSupabase()
      .from("deals")
      .insert({ title, address, stage, units, asking_price, temperature: "cold", source: "socle_mcp_seed", created_at: now, updated_at: now })
      .select("id,title,stage,address,units,asking_price,created_at")
      .single();
    if (error) throw error;
    return { ok: true, deal: data };
  }),
);

server.registerTool(
  "reset_test_seeds",
  {
    title: "Reset test seed data",
    description: "Delete all rows tagged source=socle_mcp_seed from leads and deals, and all socle_mcp automation_events. Requires writes and confirmation.",
    inputSchema: { confirm: z.literal("write to socle") },
  },
  withTool(async ({ confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const results = {};
    for (const table of ["leads", "deals"]) {
      const { count, error } = await sb.from(table).delete({ count: "planned" }).eq("source", "socle_mcp_seed");
      results[table] = error ? { error: error.message } : { deleted: count ?? 0 };
    }
    const { count: evCount, error: evErr } = await sb.from("automation_events").delete({ count: "planned" }).eq("source", "socle_mcp");
    results.automation_events = evErr ? { error: evErr.message } : { deleted: evCount ?? 0 };
    return { ok: true, deleted: results };
  }),
);

server.registerTool(
  "create_test_scenario",
  {
    title: "Create test scenario",
    description: "Seed a complete test scenario in one call. 'dashboard_full' = lead + overdue follow-up + inbound texto + open review item + stale deal. 'stale_deal' = just a stale deal. 'hot_lead' = lead + follow-up + texto. Requires writes and confirmation.",
    inputSchema: {
      scenario: z.enum(["dashboard_full", "stale_deal", "hot_lead"]).default("dashboard_full"),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ scenario = "dashboard_full", confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const now = new Date();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const phone = `+1555${Math.floor(Math.random() * 9000000) + 1000000}`;
    const created = {};

    if (scenario !== "stale_deal") {
      const { data: lead, error: leadErr } = await sb.from("leads").insert({ full_name: `[MCP Test] ${scenario}`, phone, status: "in_outreach", source: "socle_mcp_seed", created_at: now.toISOString(), updated_at: now.toISOString() }).select("id,full_name,phone").single();
      if (leadErr) throw leadErr;
      created.lead = lead;

      const { data: fu, error: fuErr } = await sb.from("follow_ups").insert({ lead_id: lead.id, due_at: yesterday.toISOString(), note: "[MCP] Overdue follow-up", status: "pending", created_at: now.toISOString() }).select("id,due_at").single();
      if (fuErr) throw fuErr;
      created.followUp = fu;

      const { data: sms, error: smsErr } = await sb.from("automation_events").insert({ source: "socle_mcp", event_type: "sms_received", status: "success", related_lead_id: lead.id, payload: { from: phone, to: "+15551112222", body: "[MCP test] Bonjour, je suis intéressé." }, occurred_at: now.toISOString() }).select("id,event_type").single();
      if (smsErr) throw smsErr;
      created.smsEvent = sms;

      if (scenario === "dashboard_full") {
        const { data: ri, error: riErr } = await sb.from("review_items").insert({ title: `[MCP] Review for ${lead.full_name}`, summary: "Auto-generated test review item.", urgency: "high", status: "open", lead_id: lead.id, created_at: now.toISOString() }).select("id,urgency").single();
        if (riErr) throw riErr;
        created.reviewItem = ri;
      }
    }

    if (scenario === "stale_deal" || scenario === "dashboard_full") {
      const staleDate = new Date(now); staleDate.setDate(staleDate.getDate() - 20);
      const { data: deal, error: dealErr } = await sb.from("deals").insert({ title: "[MCP Test] Stale deal", address: "456 Rue Stale, Québec, QC", stage: "analyse", units: 4, asking_price: 350000, temperature: "cold", source: "socle_mcp_seed", created_at: staleDate.toISOString(), updated_at: staleDate.toISOString() }).select("id,title,stage").single();
      if (dealErr) throw dealErr;
      created.deal = deal;
    }

    return { ok: true, scenario, created, tip: "Call get_dashboard_state to verify. Use reset_test_seeds to clean up." };
  }),
);

// ── PROMPT ────────────────────────────────────────────────────────────────────

server.registerPrompt(
  "socle_platform_testing",
  {
    title: "Socle platform testing workflow",
    description: "A short workflow prompt Claude/Codex can use with this MCP server.",
    argsSchema: { page: z.string().default("/textos") },
  },
  ({ page = "/textos" }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: ["Use the Socle MCP server to test the CRM safely.", "1. Call socle_health.", `2. Call create_login_link for ${safeRelativePath(page, "/")}.`, "3. Open the returned loginUrl in the browser if UI testing is needed.", "4. Use read tools first. Only use write tools when the user explicitly asks and provides the exact confirmation string."].join("\n") },
    }],
  }),
);

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Socle CRM MCP server running on stdio");
}

main().catch((error) => {
  console.error("[socle-mcp] fatal:", error);
  process.exit(1);
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getSupabase() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  if (!supabase) supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  return supabase;
}

function withTool(fn) {
  return async (args) => {
    try { return jsonResult(await fn(args ?? {})); }
    catch (error) { return errorResult(error); }
  };
}

function jsonResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function errorResult(error) {
  const message = serializeError(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }, null, 2) }] };
}

async function countRows(table, apply = (q) => q) {
  const { count, error } = await apply(getSupabase().from(table).select("id", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}

function serializeError(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = error.message ?? error.details ?? error.hint ?? error.code;
    if (maybeMessage) return String(maybeMessage);
    try { return JSON.stringify(error); }
    catch { return String(error); }
  }
  return String(error);
}

async function fetchSmsEvents(limit) {
  const { data, error } = await getSupabase()
    .from("automation_events")
    .select("id,event_type,related_lead_id,related_contact_id,payload,result,occurred_at")
    .in("event_type", ["sms_received", "sms_sent"])
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

function buildSmsConversations(events) {
  const byNumber = new Map();
  for (const event of events) {
    const number = counterpartNumber(event);
    if (!number) continue;
    const current = byNumber.get(number) ?? { number, messagesCount: 0, inboundCount: 0, outboundCount: 0, leadIds: new Set(), contactIds: new Set(), lastMessage: null };
    current.messagesCount += 1;
    if (event.event_type === "sms_received") current.inboundCount += 1;
    if (event.event_type === "sms_sent") current.outboundCount += 1;
    if (event.related_lead_id) current.leadIds.add(event.related_lead_id);
    if (event.related_contact_id) current.contactIds.add(event.related_contact_id);
    const message = toSmsMessage(event);
    if (!current.lastMessage || Date.parse(message.at) > Date.parse(current.lastMessage.at)) current.lastMessage = message;
    byNumber.set(number, current);
  }
  return [...byNumber.values()]
    .map((conv) => ({ ...conv, leadIds: [...conv.leadIds], contactIds: [...conv.contactIds] }))
    .sort((a, b) => Date.parse(b.lastMessage?.at ?? "") - Date.parse(a.lastMessage?.at ?? ""));
}

function toSmsMessage(event) {
  const payload = event.payload ?? {};
  return { id: event.id, direction: event.event_type === "sms_received" ? "inbound" : "outbound", at: event.occurred_at, from: normalizePhone(String(payload.from ?? "")) || String(payload.from ?? ""), to: normalizePhone(String(payload.to ?? "")) || String(payload.to ?? ""), body: String(payload.body ?? ""), leadId: event.related_lead_id ?? null, contactId: event.related_contact_id ?? null };
}

function counterpartNumber(event) {
  const payload = event.payload ?? {};
  const raw = event.event_type === "sms_received" ? payload.from : payload.to;
  return normalizePhone(String(raw ?? ""));
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 7 && digits.length < 16) return `+${digits}`;
  return "";
}

function requireWrites(confirm) {
  requireGovernedWrites(confirm);
  if (CODEX_OPERATOR_ENABLED && !DIRECT_MCP_WRITES_ENABLED) {
    throw new Error("Direct MCP table writes are disabled while SOCLE_CODEX_OPERATOR_ENABLED=true. Use the governed Codex phone-enrichment tools, or set SOCLE_MCP_DIRECT_WRITES_ENABLED=true for a temporary legacy escape hatch.");
  }
}

function requireGovernedWrites(confirm) {
  if (!WRITES_ENABLED) throw new Error("Writes are disabled. Set SOCLE_MCP_ALLOW_WRITES=true in the MCP client env to enable write tools.");
  if (confirm !== "write to socle") throw new Error('Write tools require confirm: "write to socle".');
}

async function callCodexOperatorEndpoint(pathname, { method = "GET", body, sessionToken } = {}) {
  if (!CODEX_OPERATOR_KEY) throw new Error("Missing SOCLE_CODEX_OPERATOR_KEY. Codex operator MCP wrappers cannot call Socle admin endpoints without it.");
  const headers = {
    "Content-Type": "application/json",
    "x-socle-codex-operator-key": CODEX_OPERATOR_KEY,
  };
  if (sessionToken) headers["x-socle-codex-session-token"] = sessionToken;
  const res = await fetch(`${APP_BASE_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `Socle endpoint ${pathname} returned ${res.status}`);
  }
  return json;
}

function assertOk(result, options = {}) {
  if (result.error) {
    if (options.allowMissingColumn && /column .* does not exist/i.test(result.error.message ?? "")) return;
    throw result.error;
  }
}

function safeRelativePath(value, fallback) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

function escapeLike(value) {
  return value.replace(/[%,]/g, (char) => `\\${char}`);
}

function startOfDay(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0); return d;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function loadEnvFiles(files) {
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = unquoteEnv(rawValue.trim());
    }
  }
}

function unquoteEnv(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}
