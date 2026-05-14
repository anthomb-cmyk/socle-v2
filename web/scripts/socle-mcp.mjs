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

let supabase = null;

const server = new McpServer({
  name: "socle-crm",
  version: "0.1.0",
});

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
      writesEnabled: WRITES_ENABLED,
      repoDir: REPO_DIR,
    };

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return {
        ok: false,
        env,
        nextStep: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in web/.env.local or in the MCP client env.",
      };
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
    if (!authEmail) {
      throw new Error("Missing auth email. Set SOCLE_MCP_AUTH_EMAIL or pass email.");
    }

    const safePath = safeRelativePath(nextPath, "/");
    const redirectTo = `${APP_BASE_URL}/auth/callback?next=${encodeURIComponent(safePath)}`;
    const { data, error } = await sb.auth.admin.generateLink({
      type: "magiclink",
      email: authEmail,
      options: { redirectTo },
    });
    if (error) throw error;

    const actionLink = data?.properties?.action_link ?? data?.action_link ?? null;
    if (!actionLink) throw new Error("Supabase did not return an action_link.");

    return {
      ok: true,
      email: authEmail,
      appBaseUrl: APP_BASE_URL,
      nextPath: safePath,
      loginUrl: actionLink,
      warning: "Treat loginUrl as sensitive. It signs the browser into Socle as the selected user.",
    };
  }),
);

server.registerTool(
  "get_dashboard_state",
  {
    title: "Get dashboard state",
    description: "Read the dashboard-critical counts, urgent review items, recent imports and recent failed automation events.",
    inputSchema: {},
  },
  withTool(async () => {
    const sb = getSupabase();
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
    const dayAgo = new Date(now); dayAgo.setDate(dayAgo.getDate() - 1);

    const CALLABLE_STATUSES = ["new", "ready_to_call", "in_outreach", "no_answer", "phone_verified"];
    const [
      openReviews,
      urgentReviews,
      newLeads,
      leadsToCall,
      overdueFollowUps,
      todayFollowUps,
      recentImports,
      recentFailures,
      urgentItems,
      activeDeals,
    ] = await Promise.all([
      countRows("review_items", (q) => q.eq("status", "open")),
      countRows("review_items", (q) => q.eq("status", "open").eq("urgency", "urgent")),
      countRows("leads", (q) => q.eq("status", "new")),
      countRows("leads", (q) => q.in("status", CALLABLE_STATUSES).not("assigned_to", "is", null)),
      countRows("follow_ups", (q) => q.eq("status", "pending").lt("due_at", todayStart.toISOString())),
      countRows("follow_ups", (q) => q.eq("status", "pending").gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString())),
      sb.from("import_jobs").select("id,file_name,status,properties_created,leads_created,errors_count,created_at").order("created_at", { ascending: false }).limit(5),
      sb.from("automation_events").select("id,source,event_type,error_message,occurred_at").eq("status", "failed").gte("occurred_at", dayAgo.toISOString()).order("occurred_at", { ascending: false }).limit(8),
      sb.from("review_items").select("id,title,summary,urgency,created_at,lead_id").eq("status", "open").order("created_at", { ascending: false }).limit(8),
      sb.from("deals").select("id,title,stage,address,units,asking_price,temperature,updated_at").not("stage", "in", '("cloture","abandonne")').order("updated_at", { ascending: false }).limit(12),
    ]);

    assertOk(recentImports);
    assertOk(recentFailures);
    assertOk(urgentItems);
    assertOk(activeDeals);

    return {
      ok: true,
      counts: {
        openReviews,
        urgentReviews,
        newLeads,
        leadsToCall,
        overdueFollowUps,
        todayFollowUps,
      },
      urgentItems: urgentItems.data ?? [],
      recentImports: recentImports.data ?? [],
      recentFailures: recentFailures.data ?? [],
      activeDeals: activeDeals.data ?? [],
    };
  }),
);

server.registerTool(
  "list_textos",
  {
    title: "List Textos conversations",
    description: "List recent SMS conversations as the Textos page sees them, grouped by counterpart phone number.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(25),
    },
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
      .filter((event) => counterpartNumber(event) === normalized)
      .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
      .slice(-limit)
      .map(toSmsMessage);
    return { ok: true, number: normalized, count: messages.length, messages };
  }),
);

server.registerTool(
  "seed_test_sms",
  {
    title: "Seed test SMS event",
    description: "Insert a synthetic SMS automation_event for Textos UI testing. Requires SOCLE_MCP_ALLOW_WRITES=true and confirmation.",
    inputSchema: {
      direction: z.enum(["inbound", "outbound"]).default("inbound"),
      from: z.string().describe("From phone number."),
      to: z.string().describe("To phone number."),
      body: z.string().min(1).max(1000),
      leadId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      dealId: z.string().uuid().optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ direction = "inbound", from, to, body, leadId, contactId, dealId, confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const eventType = direction === "inbound" ? "sms_received" : "sms_sent";
    const payload = {
      from: normalizePhone(from) || from,
      to: normalizePhone(to) || to,
      body,
      dealId: dealId ?? null,
      inserted_by: "socle-mcp",
    };
    const { data, error } = await sb
      .from("automation_events")
      .insert({
        source: "socle_mcp",
        event_type: eventType,
        status: "success",
        related_lead_id: leadId ?? null,
        related_contact_id: contactId ?? null,
        payload,
        occurred_at: new Date().toISOString(),
      })
      .select("id,event_type,occurred_at,payload")
      .single();
    if (error) throw error;
    return { ok: true, event: data };
  }),
);

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
    inputSchema: {
      id: z.string().uuid(),
    },
  },
  withTool(async ({ id }) => {
    const sb = getSupabase();
    const [deal, docs, events] = await Promise.all([
      sb.from("deals").select("*").eq("id", id).single(),
      sb.from("deal_documents").select("*").eq("deal_id", id).order("created_at", { ascending: false }).limit(20),
      sb.from("automation_events").select("id,source,event_type,status,error_message,payload,result,occurred_at").eq("related_deal_id", id).order("occurred_at", { ascending: false }).limit(30),
    ]);
    assertOk(deal);
    assertOk(docs);
    assertOk(events, { allowMissingColumn: true });
    return { ok: true, deal: deal.data, documents: docs.data ?? [], events: events.data ?? [] };
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
      update.activities = [
        { id: randomUUID(), text: activity.trim(), time: new Date().toISOString(), by: "socle-mcp" },
        ...prev,
      ];
    }
    const { data, error } = await sb.from("deals").update(update).eq("id", id).select("id,title,stage,updated_at").single();
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
    const next = mode === "replace"
      ? note
      : [previous, `[${new Date().toISOString()}] MCP\n${note}`].filter(Boolean).join("\n\n");
    const { data, error } = await sb
      .from("deals")
      .update({ [field]: next, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(`id,title,${field},updated_at`)
      .single();
    if (error) throw error;
    return { ok: true, deal: data };
  }),
);

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
      .select("id,status,urgency,title,summary,lead_id,contact_id,property_id,payload,created_at,resolved_at")
      .eq("status", status)
      .order(status === "open" ? "created_at" : "resolved_at", { ascending: false })
      .limit(limit);
    if (urgency) query = query.eq("urgency", urgency);
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, count: data?.length ?? 0, items: data ?? [] };
  }),
);

server.registerTool(
  "resolve_review_item",
  {
    title: "Defer or reject review item",
    description: "Defer or reject an open review item. Approval creates deals and should still be done in the app. Requires writes and confirmation.",
    inputSchema: {
      id: z.string().uuid(),
      action: z.enum(["defer", "reject"]),
      note: z.string().max(500).optional(),
      confirm: z.literal("write to socle"),
    },
  },
  withTool(async ({ id, action, note, confirm }) => {
    requireWrites(confirm);
    const sb = getSupabase();
    const now = new Date().toISOString();
    const status = action === "defer" ? "archived" : "rejected";
    const resolutionNote = note?.trim() || (action === "defer" ? "deferred by socle-mcp" : "rejected by socle-mcp");
    const { data, error } = await sb
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

server.registerPrompt(
  "socle_platform_testing",
  {
    title: "Socle platform testing workflow",
    description: "A short workflow prompt Claude/Codex can use with this MCP server.",
    argsSchema: {
      page: z.string().default("/textos"),
    },
  },
  ({ page = "/textos" }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Use the Socle MCP server to test the CRM safely.",
            "1. Call socle_health.",
            `2. Call create_login_link for ${safeRelativePath(page, "/")}.`,
            "3. Open the returned loginUrl in the browser if UI testing is needed.",
            "4. Use read tools first. Only use write tools when the user explicitly asks and provides the exact confirmation string.",
          ].join("\n"),
        },
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Socle CRM MCP server running on stdio");
}

main().catch((error) => {
  console.error("[socle-mcp] fatal:", error);
  process.exit(1);
});

function getSupabase() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabase;
}

function withTool(fn) {
  return async (args) => {
    try {
      return jsonResult(await fn(args ?? {}));
    } catch (error) {
      return errorResult(error);
    }
  };
}

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }, null, 2) }],
  };
}

async function countRows(table, apply = (q) => q) {
  const query = apply(getSupabase().from(table).select("id", { count: "planned", head: true }));
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
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
    const current = byNumber.get(number) ?? {
      number,
      messagesCount: 0,
      inboundCount: 0,
      outboundCount: 0,
      leadIds: new Set(),
      contactIds: new Set(),
      lastMessage: null,
    };
    current.messagesCount += 1;
    if (event.event_type === "sms_received") current.inboundCount += 1;
    if (event.event_type === "sms_sent") current.outboundCount += 1;
    if (event.related_lead_id) current.leadIds.add(event.related_lead_id);
    if (event.related_contact_id) current.contactIds.add(event.related_contact_id);
    const message = toSmsMessage(event);
    if (!current.lastMessage || Date.parse(message.at) > Date.parse(current.lastMessage.at)) {
      current.lastMessage = message;
    }
    byNumber.set(number, current);
  }

  return [...byNumber.values()]
    .map((conv) => ({
      ...conv,
      leadIds: [...conv.leadIds],
      contactIds: [...conv.contactIds],
    }))
    .sort((a, b) => Date.parse(b.lastMessage?.at ?? "") - Date.parse(a.lastMessage?.at ?? ""));
}

function toSmsMessage(event) {
  const payload = event.payload ?? {};
  return {
    id: event.id,
    direction: event.event_type === "sms_received" ? "inbound" : "outbound",
    at: event.occurred_at,
    from: normalizePhone(String(payload.from ?? "")) || String(payload.from ?? ""),
    to: normalizePhone(String(payload.to ?? "")) || String(payload.to ?? ""),
    body: String(payload.body ?? ""),
    leadId: event.related_lead_id ?? null,
    contactId: event.related_contact_id ?? null,
  };
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
  if (!WRITES_ENABLED) {
    throw new Error("Writes are disabled. Set SOCLE_MCP_ALLOW_WRITES=true in the MCP client env to enable write tools.");
  }
  if (confirm !== "write to socle") {
    throw new Error('Write tools require confirm: "write to socle".');
  }
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
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
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
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
