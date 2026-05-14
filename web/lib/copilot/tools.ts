import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth";
import { buildDefaultChecklists } from "@/lib/deals/defaults";
import { normalizePhone } from "@/lib/twilio";
import { autoLinkRecentInboundCallsToDeals } from "./auto-link-calls";
import { saveCopilotMemory, deleteCopilotMemory } from "./memory";
import { fuzzyRankRows } from "./fuzzy";

export type CopilotPageContext = {
  pathname?: string;
  href?: string;
};

export type CopilotToolContext = {
  sb: SupabaseClient;
  user: User;
  role: Role;
  page: CopilotPageContext;
};

const VALID_DEAL_STAGES = ["prospection", "analyse", "offre", "due_diligence", "financement", "cloture", "abandonne"] as const;

export const COPILOT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_current_page_context",
      description: "Read the CRM object implied by the current page URL, such as the current lead, deal, or investor.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_crm",
      description: "Search Socle CRM across deals, leads, investors, contacts, and recent call transcripts.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name, phone, address, city, company, or transcript keyword." },
          limit: { type: "number", description: "Maximum results per entity type, default 8." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_deal_dossier",
      description: "Fetch a pipeline deal dossier by UUID or human reference such as address/city/contact name.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
        },
        required: ["dealId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_lead_dossier",
      description: "Fetch a lead dossier (owner, property, phones, calls, follow-ups, submissions, events). Accepts a UUID, or a human reference like name, company, phone, or address — token + fuzzy resolver handles typos and st↔saint variants.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "string" },
        },
        required: ["leadId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_investor_dossier",
      description: "Fetch an investor dossier (profile, notes, calls, linked deals). Admin only. Accepts a UUID or a human reference (name, firm).",
      parameters: {
        type: "object",
        properties: {
          investorId: { type: "string" },
        },
        required: ["investorId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_activity",
      description: "Unified CRM activity timeline: new/updated deals, stage moves, calls, SMS, follow-ups, review items. Use for 'what changed today/this week', 'ce qui a bougé', 'récap'.",
      parameters: {
        type: "object",
        properties: {
          hours: { type: "number", description: "Lookback window in hours (default 24, max 168)." },
          limit: { type: "number", description: "Max events to return (default 30, max 80)." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_crm_counts",
      description: "Aggregate counts across the CRM. Use for 'how many hot deals', 'combien de leads par ville', 'pipeline distribution'.",
      parameters: {
        type: "object",
        properties: {
          entity: { type: "string", enum: ["deal", "lead", "investor"] },
          groupBy: { type: "string", enum: ["stage", "temperature", "priority", "city", "assigned_to", "status", "none"] },
          filters: {
            type: "object",
            description: "Optional filters: { stage, temperature, city, assigned_to, status }. Each value can be a single string or array of strings.",
            additionalProperties: true,
          },
        },
        required: ["entity"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_today_work",
      description: "Summarize today's CRM work: due follow-ups, urgent reviews, ready-to-call leads, hot deals, and auto-linked calls.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pipeline_health",
      description: "Find pipeline deals that are stale, missing next actions, missing seller phone, or need attention.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_note",
      description: "Append a CRM note to a lead, deal, or investor. Use only after the user clearly asks to save/add a note.",
      parameters: {
        type: "object",
        properties: {
          targetType: { type: "string", enum: ["lead", "deal", "investor"] },
          id: { type: "string" },
          note: { type: "string" },
          section: { type: "string", enum: ["notes", "deal", "seller", "ai"] },
        },
        required: ["targetType", "id", "note"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_follow_up",
      description: "Create a calendar-visible follow-up for a lead/contact/deal. Deal ids may be UUIDs or human references such as address/city/contact name.",
      parameters: {
        type: "object",
        properties: {
          targetType: { type: "string", enum: ["lead", "contact", "deal"] },
          id: { type: "string" },
          dueAt: { type: "string", description: "ISO datetime." },
          note: { type: "string" },
          priority: { type: "number" },
        },
        required: ["targetType", "id", "dueAt", "note"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_deal_stage",
      description: "Move a pipeline deal to another stage. Requires confirmed=true; without it, returns a preview for the user to approve.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
          stage: { type: "string", enum: VALID_DEAL_STAGES },
          reason: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["dealId", "stage"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "match_investors_to_deal",
      description: "Rank investors for a deal using geography, ticket overlap, and investor criteria.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
          limit: { type: "number" },
        },
        required: ["dealId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_deal_from_lead",
      description: "Create a pipeline deal from an existing lead. Requires confirmed=true. If not confirmed, returns a confirmation preview.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "string" },
          confirmed: { type: "boolean" },
          stage: { type: "string", enum: VALID_DEAL_STAGES },
        },
        required: ["leadId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_copilot_memory",
      description: "Save a short durable note about the user (preference, fact, workflow, constraint) so future Copilot sessions can apply it. Use sparingly — only when the user states something that should persist across conversations.",
      parameters: {
        type: "object",
        properties: {
          body: { type: "string", description: "Under 400 chars. State the rule and (if relevant) the reason." },
          kind: { type: "string", enum: ["preference", "fact", "workflow", "constraint"] },
        },
        required: ["body"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_copilot_memory",
      description: "Remove a Copilot memory the user no longer wants. Pass the memory id surfaced in the loaded memory list.",
      parameters: {
        type: "object",
        properties: {
          memoryId: { type: "string" },
        },
        required: ["memoryId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_text_message",
      description: "Draft an SMS based on CRM context without sending it.",
      parameters: {
        type: "object",
        properties: {
          targetType: { type: "string", enum: ["lead", "deal", "investor"] },
          id: { type: "string" },
          purpose: { type: "string" },
        },
        required: ["targetType", "id", "purpose"],
        additionalProperties: false,
      },
    },
  },
] as const;

export async function runCopilotTool(name: string, rawArgs: string, ctx: CopilotToolContext) {
  let args: unknown = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { ok: false, error: "Invalid JSON tool arguments." };
  }

  switch (name) {
    case "get_current_page_context":
      return getCurrentPageContext(ctx);
    case "search_crm":
      return searchCrm(ctx, SearchArgs.parse(args));
    case "get_deal_dossier":
      return getDealDossier(ctx, IdArg("dealId").parse(args).dealId);
    case "get_lead_dossier":
      return getLeadDossier(ctx, IdArg("leadId").parse(args).leadId);
    case "get_investor_dossier":
      return getInvestorDossier(ctx, IdArg("investorId").parse(args).investorId);
    case "get_today_work":
      return getTodayWork(ctx);
    case "get_pipeline_health":
      return getPipelineHealth(ctx, LimitArg.parse(args).limit);
    case "get_recent_activity":
      return getRecentActivity(ctx, RecentActivityArgs.parse(args));
    case "get_crm_counts":
      return getCrmCounts(ctx, CrmCountsArgs.parse(args));
    case "add_note":
      return addNote(ctx, AddNoteArgs.parse(args));
    case "schedule_follow_up":
      return scheduleFollowUp(ctx, FollowUpArgs.parse(args));
    case "update_deal_stage":
      return updateDealStage(ctx, UpdateDealStageArgs.parse(args));
    case "match_investors_to_deal":
      return matchInvestorsToDeal(ctx, MatchInvestorsArgs.parse(args));
    case "create_deal_from_lead":
      return createDealFromLead(ctx, CreateDealFromLeadArgs.parse(args));
    case "draft_text_message":
      return draftTextMessage(ctx, DraftTextArgs.parse(args));
    case "save_copilot_memory": {
      const parsed = SaveMemoryArgs.parse(args);
      return saveCopilotMemory(ctx.sb, ctx.user.id, parsed.body, parsed.kind ?? "preference");
    }
    case "delete_copilot_memory": {
      const parsed = DeleteMemoryArgs.parse(args);
      return deleteCopilotMemory(ctx.sb, ctx.user.id, parsed.memoryId);
    }
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

const SearchArgs = z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20).optional() });
const LimitArg = z.object({ limit: z.number().int().min(1).max(50).optional() });
const AddNoteArgs = z.object({
  targetType: z.enum(["lead", "deal", "investor"]),
  id: z.string().min(1),
  note: z.string().min(1).max(4000),
  section: z.enum(["notes", "deal", "seller", "ai"]).optional(),
});
const FollowUpArgs = z.object({
  targetType: z.enum(["lead", "contact", "deal"]),
  id: z.string().min(1),
  dueAt: z.string().min(1),
  note: z.string().min(1).max(1000),
  priority: z.number().int().min(0).max(100).optional(),
});
const UpdateDealStageArgs = z.object({
  dealId: z.string().min(1),
  stage: z.enum(VALID_DEAL_STAGES),
  reason: z.string().max(500).optional(),
  confirmed: z.boolean().optional(),
});
const MatchInvestorsArgs = z.object({ dealId: z.string().min(1), limit: z.number().int().min(1).max(20).optional() });
const CreateDealFromLeadArgs = z.object({
  leadId: z.string().min(1),
  confirmed: z.boolean().optional(),
  stage: z.enum(VALID_DEAL_STAGES).optional(),
});
const DraftTextArgs = z.object({
  targetType: z.enum(["lead", "deal", "investor"]),
  id: z.string().min(1),
  purpose: z.string().min(1).max(500),
});
const SaveMemoryArgs = z.object({
  body: z.string().min(1).max(400),
  kind: z.enum(["preference", "fact", "workflow", "constraint"]).optional(),
});
const DeleteMemoryArgs = z.object({ memoryId: z.string().min(1) });
const RecentActivityArgs = z.object({
  hours: z.number().int().min(1).max(168).optional(),
  limit: z.number().int().min(1).max(80).optional(),
});
const CrmCountsArgs = z.object({
  entity: z.enum(["deal", "lead", "investor"]),
  groupBy: z.enum(["stage", "temperature", "priority", "city", "assigned_to", "status", "none"]).optional(),
  filters: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number(), z.boolean(), z.null()])).optional(),
});

function IdArg(key: string) {
  return z.object({ [key]: z.string().min(1) });
}

async function getCurrentPageContext(ctx: CopilotToolContext) {
  const path = ctx.page.pathname ?? "";
  const dealId = matchPath(path, /^\/pipeline\/([^/?#]+)/);
  if (dealId) return getDealDossier(ctx, dealId);
  const leadId = matchPath(path, /^\/leads\/([^/?#]+)/);
  if (leadId) return getLeadDossier(ctx, leadId);
  const investorId = matchPath(path, /^\/investisseurs\/([^/?#]+)/);
  if (investorId && investorId !== "nouveau") return getInvestorDossier(ctx, investorId);
  const callLeadId = matchPath(path, /^\/calls\/([^/?#]+)/);
  if (callLeadId) return getLeadDossier(ctx, callLeadId);
  return { ok: true, page: ctx.page, message: "No single CRM record is implied by this page." };
}

async function searchCrm(ctx: CopilotToolContext, input: z.infer<typeof SearchArgs>) {
  const limit = input.limit ?? 8;
  const digits = input.query.replace(/\D/g, "");
  const phone = normalizePhone(input.query);
  const tokens = dealReferenceTokens(input.query).slice(0, 4);

  // Build an AND-of-OR ilike filter on a list of columns from the tokens.
  // Each token becomes one .or(...) call; chained calls are AND'd together.
  function applyTokenFilters<T>(query: T, columns: string[]): T {
    if (tokens.length === 0) return query;
    let q = query as unknown as {
      or: (filter: string) => unknown;
    };
    for (const token of tokens) {
      const variants = tokenSqlVariants(token).map((v) => v.replace(/[%_,()]/g, " "));
      const ors = variants.flatMap((v) => columns.map((col) => `${col}.ilike.%${v}%`));
      q = q.or(ors.join(",")) as typeof q;
    }
    return q as unknown as T;
  }

  const dealsBase = ctx.sb.from("deals")
    .select("id,title,stage,address,units,asking_price,temperature,contact_name,contact_phone,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  const leadsBase = ctx.sb.from("leads_view")
    .select("lead_id,full_name,company_name,address,city,best_phone,status,priority,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  const investorsBase = ctx.sb.from("investors")
    .select("id,full_name,firm_name,email,phone_e164,city,status,preferred_geography,asset_class_focus,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  const contactsBase = ctx.sb.from("contacts")
    .select("id,full_name,company_name,kind,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  const callsBase = ctx.sb.from("call_logs")
    .select("id,direction,recorded_at,duration_sec,outcome,notes,summary,transcript,raw")
    .order("recorded_at", { ascending: false })
    .limit(Math.min(limit, 5));

  const [deals, leads, investors, contacts, calls] = await Promise.all([
    applyTokenFilters(dealsBase, ["title", "address", "contact_name"]),
    applyTokenFilters(leadsBase, ["full_name", "company_name", "address", "city", "best_phone"]),
    ctx.role === "admin"
      ? applyTokenFilters(investorsBase, ["full_name", "firm_name", "preferred_geography", "asset_class_focus", "notes"])
      : Promise.resolve({ data: [] }),
    applyTokenFilters(contactsBase, ["full_name", "company_name"]),
    tokens.length || phone || digits
      ? applyTokenFilters(callsBase, ["notes", "summary", "transcript"])
      : Promise.resolve({ data: [] }),
  ]);

  const phoneMatchedDeals = phone
    ? ((deals.data ?? []) as Array<{ contact_phone?: string | null }>).filter((deal) => normalizePhone(deal.contact_phone ?? "") === phone)
    : [];

  // Fuzzy fallback per entity when exact token search produced nothing.
  // The user types fast, makes typos — we'd rather return close matches with
  // a similarity score than empty arrays.
  const dealsExact = (deals.data ?? []) as unknown as Array<Record<string, unknown>>;
  const leadsExact = (leads.data ?? []) as unknown as Array<Record<string, unknown>>;
  const investorsExact = (investors.data ?? []) as unknown as Array<Record<string, unknown>>;
  const contactsExact = (contacts.data ?? []) as unknown as Array<Record<string, unknown>>;

  let dealsFuzzy: typeof dealsExact = [];
  let leadsFuzzy: typeof leadsExact = [];
  let investorsFuzzy: typeof investorsExact = [];
  let contactsFuzzy: typeof contactsExact = [];

  const trimmedQuery = input.query.trim();
  if (trimmedQuery.length >= 3) {
    const fuzzyPromises: Promise<void>[] = [];
    if (dealsExact.length === 0) {
      fuzzyPromises.push((async () => {
        const { data } = await ctx.sb.from("deals").select("id,title,stage,address,contact_name,contact_phone,updated_at").not("stage", "in", '("cloture","abandonne")').order("updated_at", { ascending: false }).limit(400);
        dealsFuzzy = fuzzyRankRows((data ?? []) as unknown as Array<Record<string, unknown>>, trimmedQuery, ["title", "address", "contact_name"]).slice(0, limit).map((f) => ({ ...f.row, _fuzzy: Number(f.score.toFixed(3)) }));
      })());
    }
    if (leadsExact.length === 0) {
      fuzzyPromises.push((async () => {
        const baseQ = ctx.sb.from("leads_view").select("lead_id,full_name,company_name,address,city,best_phone,status,updated_at").order("updated_at", { ascending: false }).limit(400);
        const { data } = await (ctx.role === "admin" ? baseQ : baseQ.eq("assigned_to", ctx.user.id));
        leadsFuzzy = fuzzyRankRows((data ?? []) as unknown as Array<Record<string, unknown>>, trimmedQuery, ["full_name", "company_name", "address", "city"]).slice(0, limit).map((f) => ({ ...f.row, _fuzzy: Number(f.score.toFixed(3)) }));
      })());
    }
    if (investorsExact.length === 0 && ctx.role === "admin") {
      fuzzyPromises.push((async () => {
        const { data } = await ctx.sb.from("investors").select("id,full_name,firm_name,city,status,preferred_geography,updated_at").order("updated_at", { ascending: false }).limit(400);
        investorsFuzzy = fuzzyRankRows((data ?? []) as unknown as Array<Record<string, unknown>>, trimmedQuery, ["full_name", "firm_name", "preferred_geography"]).slice(0, limit).map((f) => ({ ...f.row, _fuzzy: Number(f.score.toFixed(3)) }));
      })());
    }
    if (contactsExact.length === 0) {
      fuzzyPromises.push((async () => {
        const { data } = await ctx.sb.from("contacts").select("id,full_name,company_name,kind,updated_at").order("updated_at", { ascending: false }).limit(400);
        contactsFuzzy = fuzzyRankRows((data ?? []) as unknown as Array<Record<string, unknown>>, trimmedQuery, ["full_name", "company_name"]).slice(0, limit).map((f) => ({ ...f.row, _fuzzy: Number(f.score.toFixed(3)) }));
      })());
    }
    await Promise.all(fuzzyPromises);
  }

  const dealsCombined = compactRows([...phoneMatchedDeals, ...dealsExact, ...dealsFuzzy], limit);
  const usedFuzzy: string[] = [];
  if (dealsFuzzy.length > 0) usedFuzzy.push("deals");
  if (leadsFuzzy.length > 0) usedFuzzy.push("leads");
  if (investorsFuzzy.length > 0) usedFuzzy.push("investors");
  if (contactsFuzzy.length > 0) usedFuzzy.push("contacts");

  return {
    ok: true,
    query: input.query,
    fuzzyFallback: usedFuzzy.length > 0 ? usedFuzzy : undefined,
    results: {
      deals: dealsCombined,
      leads: leadsExact.length > 0 ? leadsExact : leadsFuzzy,
      investors: investorsExact.length > 0 ? investorsExact : investorsFuzzy,
      contacts: contactsExact.length > 0 ? contactsExact : contactsFuzzy,
      calls: ((calls.data ?? []) as Array<{ transcript?: string | null; notes?: string | null; summary?: string | null }>)
        .map((call) => ({
          ...call,
          transcript: untrusted(excerpt(call.transcript, 700)),
          notes: untrusted(excerpt(call.notes, 400)),
          summary: untrusted(excerpt(call.summary, 500)),
        })),
    },
  };
}

async function getDealDossier(ctx: CopilotToolContext, dealId: string) {
  const resolved = await resolveDealReference(ctx, dealId, "id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,contact_phone,contact_email,notes_deal,notes_vendeur,ai_analysis,next_action,checklists,activities,lat,lng,created_at,updated_at");
  if (!resolved.ok) return resolved;
  const deal = resolved.deal;
  const resolvedDealId = String(deal.id);

  const dealPhone = normalizePhone(String((deal as { contact_phone?: string | null }).contact_phone ?? ""));
  const [docs, rawDealCalls, phoneCalls, linkedInvestors, smsEvents] = await Promise.all([
    ctx.sb.from("deal_documents").select("id,name,size,mime_type,created_at").eq("deal_id", resolvedDealId).order("created_at", { ascending: false }).limit(10),
    ctx.sb.from("call_logs")
      .select("id,direction,outcome,notes,summary,recorded_at,duration_sec,transcript_status,transcript,raw")
      .filter("raw->>deal_id", "eq", resolvedDealId)
      .order("recorded_at", { ascending: false })
      .limit(10),
    dealPhone
      ? ctx.sb.from("call_logs")
          .select("id,direction,outcome,notes,summary,recorded_at,duration_sec,transcript_status,transcript,raw")
          .filter("raw->>from", "eq", dealPhone)
          .order("recorded_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    ctx.role === "admin"
      ? ctx.sb.from("investor_deals")
          .select("id,stage,ticket_size_cad,notes,investors(id,full_name,firm_name,preferred_geography,ticket_size_min_cad,ticket_size_max_cad)")
          .eq("pipeline_deal_id", resolvedDealId)
          .order("updated_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    ctx.sb.from("automation_events")
      .select("id,event_type,payload,occurred_at")
      .in("event_type", ["sms_received", "sms_sent"])
      .order("occurred_at", { ascending: false })
      .limit(80),
  ]);

  const callsById = new Map<string, unknown>();
  for (const row of [...(rawDealCalls.data ?? []), ...(phoneCalls.data ?? [])] as Array<{ id: string }>) {
    callsById.set(row.id, compactCall(row));
  }

  const sms = ((smsEvents.data ?? []) as Array<{ id: string; event_type: string; payload: Record<string, unknown> | null; occurred_at: string }>)
    .filter((event) => {
      const payload = event.payload ?? {};
      if (String(payload.dealId ?? payload.deal_id ?? "") === resolvedDealId) return true;
      if (!dealPhone) return false;
      return normalizePhone(String(payload.from ?? "")) === dealPhone || normalizePhone(String(payload.to ?? "")) === dealPhone;
    })
    .slice(0, 12);

  return {
    ok: true,
    type: "deal_dossier",
    resolvedFrom: dealId,
    deal,
    documents: docs.data ?? [],
    calls: Array.from(callsById.values()),
    sms,
    linkedInvestors: linkedInvestors.data ?? [],
  };
}

async function getLeadDossier(ctx: CopilotToolContext, leadId: string) {
  const resolved = await resolveLeadReference(ctx, leadId);
  if (!resolved.ok) return resolved;
  const lead = resolved.lead;
  leadId = String(lead.lead_id);

  const leadRow = lead as { assigned_to?: string | null; contact_id?: string | null; property_id?: string | null };
  if (ctx.role !== "admin" && leadRow.assigned_to !== ctx.user.id) {
    return { ok: false, error: "Forbidden for this lead." };
  }

  const [phones, calls, followUps, submissions, events, property, contact] = await Promise.all([
    leadRow.contact_id
      ? ctx.sb.from("phones").select("id,e164,display,status,source,confidence,evidence,notes,created_at").eq("contact_id", leadRow.contact_id).order("confidence", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),
    ctx.sb.from("call_logs").select("id,outcome,notes,summary,recorded_at,duration_sec,transcript_status,transcript").eq("lead_id", leadId).order("recorded_at", { ascending: false }).limit(8),
    ctx.sb.from("follow_ups").select("id,due_at,note,priority,status,assigned_to,source,created_at").eq("lead_id", leadId).order("due_at", { ascending: true }).limit(10),
    ctx.sb.from("lead_submissions").select("id,outcome,seller_interest_level,timeline,motivation,asking_price,caller_summary,recommended_action,status,created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(8),
    ctx.sb.from("automation_events").select("id,source,event_type,status,error_message,payload,occurred_at").eq("related_lead_id", leadId).order("occurred_at", { ascending: false }).limit(12),
    leadRow.property_id ? ctx.sb.from("properties").select("*").eq("id", leadRow.property_id).maybeSingle() : Promise.resolve({ data: null }),
    leadRow.contact_id ? ctx.sb.from("contacts").select("*").eq("id", leadRow.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return {
    ok: true,
    type: "lead_dossier",
    lead,
    property: property.data,
    contact: contact.data,
    phones: phones.data ?? [],
    calls: ((calls.data ?? []) as unknown[]).map(compactCall),
    followUps: followUps.data ?? [],
    submissions: submissions.data ?? [],
    events: events.data ?? [],
  };
}

async function getInvestorDossier(ctx: CopilotToolContext, investorId: string) {
  if (ctx.role !== "admin") return { ok: false, error: "Admin only." };
  const resolved = await resolveInvestorReference(ctx, investorId);
  if (!resolved.ok) return resolved;
  investorId = String(resolved.investor.id);
  const [investor, calls, deals, notes] = await Promise.all([
    ctx.sb.from("investors").select("*").eq("id", investorId).maybeSingle(),
    ctx.sb.from("investor_calls").select("id,direction,duration_sec,transcript_status,summary,started_at,recorded_at,created_at").eq("investor_id", investorId).order("created_at", { ascending: false }).limit(8),
    ctx.sb.from("investor_deals").select("*,pipeline_deal:deals(id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,contact_phone,next_action,notes_deal,notes_vendeur)").eq("investor_id", investorId).order("updated_at", { ascending: false }).limit(12),
    ctx.sb.from("investor_notes").select("*").eq("investor_id", investorId).order("created_at", { ascending: false }).limit(12),
  ]);
  if (investor.error) return { ok: false, error: investor.error.message };
  if (!investor.data) return { ok: false, error: "Investor not found." };
  return { ok: true, type: "investor_dossier", investor: investor.data, calls: calls.data ?? [], deals: deals.data ?? [], notes: notes.data ?? [] };
}

async function getTodayWork(ctx: CopilotToolContext) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);

  const followUpsQuery = ctx.sb.from("follow_ups")
    .select("id,lead_id,contact_id,due_at,note,priority,status,assigned_to")
    .eq("status", "pending")
    .lt("due_at", tomorrow.toISOString())
    .order("due_at", { ascending: true })
    .limit(20);
  if (ctx.role !== "admin") followUpsQuery.eq("assigned_to", ctx.user.id);

  const [followUps, urgentReviews, readyLeads, hotDeals, autoLinked] = await Promise.all([
    followUpsQuery,
    ctx.role === "admin"
      ? ctx.sb.from("review_items").select("id,title,urgency,payload,created_at").eq("status", "open").eq("urgency", "urgent").order("created_at", { ascending: true }).limit(10)
      : Promise.resolve({ data: [] }),
    ctx.sb.from("leads_view").select("lead_id,full_name,company_name,address,city,best_phone,priority,status").eq("status", "ready_to_call").order("priority", { ascending: false }).limit(10),
    ctx.sb.from("deals").select("id,title,stage,address,temperature,priority,next_action,updated_at").eq("temperature", "chaud").not("stage", "in", '("cloture","abandonne")').order("updated_at", { ascending: false }).limit(10),
    autoLinkRecentInboundCallsToDeals(ctx.sb, { limit: 100, source: "socle_copilot", triggeredBy: ctx.user.id }),
  ]);

  const followUpRows = (followUps.data ?? []) as Array<{ id: string; lead_id: string | null; due_at: string; note: string; priority: number | null }>;
  const reviewRows = (urgentReviews.data ?? []) as Array<{ id: string; title: string | null; created_at: string }>;
  const leadRows = (readyLeads.data ?? []) as Array<{ lead_id: string; full_name: string | null; address: string | null; city: string | null; priority: number | null }>;
  const dealRows = (hotDeals.data ?? []) as Array<{ id: string; title: string | null; stage: string | null; next_action: string | null; updated_at: string }>;

  const nowMs = now.getTime();
  const topPriorities: Array<{ type: string; id: string; why: string; suggestedAction: string; score: number }> = [];

  for (const fu of followUpRows) {
    const overdueHours = Math.max(0, (nowMs - new Date(fu.due_at).getTime()) / 3_600_000);
    topPriorities.push({
      type: "follow_up",
      id: fu.id,
      why: overdueHours > 1
        ? `Suivi en retard de ${Math.round(overdueHours)}h: ${fu.note.slice(0, 80)}`
        : `Suivi dû aujourd'hui: ${fu.note.slice(0, 80)}`,
      suggestedAction: "Appeler ou texter, puis complete_follow_up.",
      score: 1000 + Math.min(overdueHours, 168) * 5 + (fu.priority ?? 0),
    });
  }
  for (const rv of reviewRows) {
    const ageHours = (nowMs - new Date(rv.created_at).getTime()) / 3_600_000;
    topPriorities.push({
      type: "review_item",
      id: rv.id,
      why: `Review urgent: ${rv.title ?? "(sans titre)"}`,
      suggestedAction: "Ouvre /reviews et résous l'item.",
      score: 800 + Math.min(ageHours, 168),
    });
  }
  for (const deal of dealRows) {
    if (!deal.next_action) {
      topPriorities.push({
        type: "deal",
        id: deal.id,
        why: `Deal chaud sans next_action: ${deal.title ?? deal.id}`,
        suggestedAction: "Définis un next_action ou planifie un follow-up.",
        score: 600,
      });
    }
  }
  for (const lead of leadRows.slice(0, 5)) {
    topPriorities.push({
      type: "lead",
      id: lead.lead_id,
      why: `Lead prêt à appeler: ${lead.full_name ?? lead.address ?? lead.lead_id}`,
      suggestedAction: "Compose depuis /calls.",
      score: 400 + (lead.priority ?? 0),
    });
  }
  topPriorities.sort((a, b) => b.score - a.score);

  return {
    ok: true,
    date: now.toISOString(),
    topPriorities: topPriorities.slice(0, 8),
    followUps: followUpRows,
    urgentReviews: reviewRows,
    readyLeads: leadRows,
    hotDeals: dealRows,
    autoLinkedCalls: autoLinked,
  };
}

async function getPipelineHealth(ctx: CopilotToolContext, limit = 20) {
  const staleCutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString();
  const { data, error } = await ctx.sb
    .from("deals")
    .select("id,title,stage,address,temperature,priority,contact_name,contact_phone,next_action,updated_at,notes_deal,notes_vendeur")
    .not("stage", "in", '("cloture","abandonne")')
    .order("updated_at", { ascending: true })
    .limit(Math.min(limit, 50));
  if (error) return { ok: false, error: error.message };
  const deals = data ?? [];
  const stale = deals.filter((deal) => String(deal.updated_at ?? "") < staleCutoff);
  const missingNextAction = deals.filter((deal) => !deal.next_action);
  const missingSellerPhone = deals.filter((deal) => !normalizePhone(deal.contact_phone ?? ""));
  const missingSellerNotes = deals.filter((deal) => !deal.notes_vendeur);

  const issues = stale.length + missingNextAction.length + missingSellerPhone.length;
  const verdictRank = issues === 0 ? "healthy" : issues < 5 ? "minor" : issues < 12 ? "moderate" : "needs_attention";
  const topRisk = pickTopRisk(stale, missingNextAction, missingSellerPhone);

  return {
    ok: true,
    staleCutoff,
    verdict: verdictRank,
    issueCount: issues,
    topRisk,
    stale,
    missingNextAction,
    missingSellerPhone,
    missingSellerNotes,
  };
}

function pickTopRisk(
  stale: Array<Record<string, unknown>>,
  missingNextAction: Array<Record<string, unknown>>,
  missingSellerPhone: Array<Record<string, unknown>>,
) {
  if (stale.length > 0) {
    const oldest = stale[0];
    return {
      category: "stale",
      message: `${stale.length} deal(s) sans activité depuis 14j. Plus ancien: ${String(oldest?.title ?? oldest?.id ?? "")}`,
      dealId: oldest?.id ?? null,
    };
  }
  if (missingNextAction.length > 0) {
    const first = missingNextAction[0];
    return {
      category: "missing_next_action",
      message: `${missingNextAction.length} deal(s) sans next_action. Commence par: ${String(first?.title ?? first?.id ?? "")}`,
      dealId: first?.id ?? null,
    };
  }
  if (missingSellerPhone.length > 0) {
    const first = missingSellerPhone[0];
    return {
      category: "missing_seller_phone",
      message: `${missingSellerPhone.length} deal(s) sans téléphone vendeur.`,
      dealId: first?.id ?? null,
    };
  }
  return null;
}

async function addNote(ctx: CopilotToolContext, input: z.infer<typeof AddNoteArgs>) {
  const stamp = `[Copilot · ${new Date().toLocaleString("fr-CA")}]`;
  if (input.targetType === "lead") {
    const { data: lead } = await ctx.sb.from("leads").select("notes,assigned_to").eq("id", input.id).maybeSingle();
    if (!lead) return { ok: false, error: "Lead not found." };
    if (ctx.role !== "admin" && lead.assigned_to !== ctx.user.id) return { ok: false, error: "Forbidden for this lead." };
    const next = appendBlock(lead.notes ?? "", stamp, input.note);
    const { error } = await ctx.sb.from("leads").update({ notes: next }).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, targetType: "lead", id: input.id, appended: true };
  }

  if (input.targetType === "deal") {
    const field = input.section === "seller" ? "notes_vendeur" : input.section === "ai" ? "ai_analysis" : "notes_deal";
    const resolved = await resolveDealReference(ctx, input.id, `id,title,${field},activities`);
    if (!resolved.ok) return resolved;
    const deal = resolved.deal;
    const existing = String((deal as Record<string, unknown>)[field] ?? "");
    const activities = Array.isArray((deal as { activities?: unknown }).activities) ? (deal as { activities: unknown[] }).activities : [];
    const { error } = await ctx.sb.from("deals").update({
      [field]: appendBlock(existing, stamp, input.note),
      activities: [{ id: crypto.randomUUID(), text: `Note ajoutée via Copilot (${field})`, time: new Date().toISOString(), by: ctx.user.id }, ...activities],
      updated_at: new Date().toISOString(),
    }).eq("id", deal.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, targetType: "deal", id: deal.id, title: deal.title, field, appended: true };
  }

  if (ctx.role !== "admin") return { ok: false, error: "Admin only for investor notes." };
  const { data, error } = await ctx.sb.from("investor_notes").insert({
    investor_id: input.id,
    body: `${stamp}\n${input.note}`,
    author_id: ctx.user.id,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, targetType: "investor", id: input.id, noteId: data?.id };
}

async function scheduleFollowUp(ctx: CopilotToolContext, input: z.infer<typeof FollowUpArgs>) {
  const due = parseFlexibleDate(input.dueAt);
  if (!due) return { ok: false, error: `Invalid dueAt "${input.dueAt}". Pass an ISO datetime or a clear natural phrase like "5 mai 14h", "demain 10h", "vendredi".` };

  if (input.targetType === "deal") {
    const resolved = await resolveDealReference(ctx, input.id, "id,title,address,contact_name,contact_phone,activities");
    if (!resolved.ok) return resolved;
    const deal = resolved.deal;
    const activities = Array.isArray(deal.activities) ? deal.activities : [];
    const calendarNote = `Deal: ${deal.title} — ${input.note} — /pipeline/${deal.id}`;
    const [dealUpdate, followUpInsert] = await Promise.all([
      ctx.sb.from("deals").update({
      next_action: `${due.toLocaleString("fr-CA")} · ${input.note}`,
      activities: [{ id: crypto.randomUUID(), text: `Suivi planifié: ${input.note} (${due.toISOString()})`, time: new Date().toISOString(), by: ctx.user.id }, ...activities],
      updated_at: new Date().toISOString(),
      }).eq("id", deal.id),
      ctx.sb.from("follow_ups").insert({
        lead_id: null,
        contact_id: null,
        due_at: due.toISOString(),
        note: calendarNote,
        priority: input.priority ?? 80,
        status: "pending",
        assigned_to: ctx.user.id,
        created_by: ctx.user.id,
        source: "socle_copilot_deal",
      }).select("id").single(),
    ]);
    const error = dealUpdate.error ?? followUpInsert.error;
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      targetType: "deal",
      id: deal.id,
      title: deal.title,
      dueAt: due.toISOString(),
      nextAction: true,
      calendarFollowUpId: followUpInsert.data?.id,
    };
  }

  const insert = {
    lead_id: input.targetType === "lead" ? input.id : null,
    contact_id: input.targetType === "contact" ? input.id : null,
    due_at: due.toISOString(),
    note: input.note,
    priority: input.priority ?? 70,
    status: "pending",
    assigned_to: ctx.user.id,
    created_by: ctx.user.id,
    source: "socle_copilot",
  };
  const { data, error } = await ctx.sb.from("follow_ups").insert(insert).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, targetType: input.targetType, id: input.id, followUpId: data?.id };
}

async function updateDealStage(ctx: CopilotToolContext, input: z.infer<typeof UpdateDealStageArgs>) {
  const resolved = await resolveDealReference(ctx, input.dealId, "id,activities,stage,title");
  if (!resolved.ok) return resolved;
  const deal = resolved.deal;
  if (deal.stage === input.stage) {
    return { ok: true, noop: true, dealId: deal.id, title: deal.title, stage: input.stage };
  }
  if (!input.confirmed) {
    return {
      ok: true,
      requires_confirmation: true,
      preview: {
        dealId: deal.id,
        title: deal.title,
        previousStage: deal.stage,
        stage: input.stage,
        reason: input.reason ?? null,
      },
      message: "Confirm with confirmed=true to apply this stage change.",
    };
  }
  const activities = Array.isArray(deal.activities) ? deal.activities : [];
  const text = `Stade changé via Copilot: ${deal.stage} → ${input.stage}${input.reason ? ` · ${input.reason}` : ""}`;
  const { error } = await ctx.sb.from("deals").update({
    stage: input.stage,
    activities: [{ id: crypto.randomUUID(), text, time: new Date().toISOString(), by: ctx.user.id }, ...activities],
    updated_at: new Date().toISOString(),
  }).eq("id", deal.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, dealId: deal.id, title: deal.title, previousStage: deal.stage, stage: input.stage };
}

async function matchInvestorsToDeal(ctx: CopilotToolContext, input: z.infer<typeof MatchInvestorsArgs>) {
  if (ctx.role !== "admin") return { ok: false, error: "Admin only." };
  const limit = input.limit ?? 8;
  const resolved = await resolveDealReference(ctx, input.dealId, "id,title,address,units,asking_price,offer_price,temperature,priority");
  if (!resolved.ok) return resolved;
  const [investorsRes] = await Promise.all([
    ctx.sb.from("investors").select("id,full_name,firm_name,status,capital_available_cad,ticket_size_min_cad,ticket_size_max_cad,preferred_geography,asset_class_focus,notes,updated_at").eq("status", "active").limit(500),
  ]);
  const deal = resolved.deal;
  const price = Number(deal.offer_price ?? deal.asking_price ?? 0);
  const dealText = normalizeDealText(String([deal.title, deal.address].filter(Boolean).join(" ")));
  const nowMs = Date.now();
  const ranked = ((investorsRes.data ?? []) as Array<Record<string, unknown>>).map((inv) => {
    let score = 0;
    const reasons: string[] = [];

    let geoHit: string | null = null;
    for (const geo of splitTags(String(inv.preferred_geography ?? ""))) {
      if (geoMatches(dealText, geo)) { geoHit = geo; break; }
    }
    if (geoHit) {
      score += 35;
      reasons.push(`géo: ${geoHit}`);
    }

    const min = Number(inv.ticket_size_min_cad ?? 0);
    const max = Number(inv.ticket_size_max_cad ?? 0);
    if (price > 0) {
      if ((!min || price >= min) && (!max || price <= max)) {
        score += 30;
        reasons.push("ticket overlap");
      } else if (min && price < min * 0.7) {
        score -= 15;
        reasons.push("ticket trop petit");
      } else if (max && price > max * 1.3) {
        score -= 15;
        reasons.push("ticket trop gros");
      }
    }

    if (Number(inv.capital_available_cad ?? 0) >= price && price > 0) {
      score += 20;
      reasons.push("capital suffisant");
    }

    const focus = String(inv.asset_class_focus ?? "") + " " + String(inv.notes ?? "");
    if (deal.units && /plex|multi|multifamil/i.test(focus)) {
      score += 10;
      reasons.push("focus multifamilial");
    }

    const updatedAt = inv.updated_at ? new Date(String(inv.updated_at)).getTime() : 0;
    if (updatedAt) {
      const daysSince = (nowMs - updatedAt) / 86_400_000;
      if (daysSince < 30) {
        score += 8;
        reasons.push("récemment actif");
      } else if (daysSince > 180) {
        score -= 5;
      }
    }

    return { investor: inv, score, reasons };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  return { ok: true, deal, matches: ranked };
}

// Geography matching: token-aware, accent-insensitive, and tolerant of
// hyphenated Quebec names (Montréal-Nord, Laval-des-Rapides, etc.).
function geoMatches(dealTextNormalized: string, geo: string) {
  const normalizedGeo = normalizeDealText(geo);
  if (!normalizedGeo) return false;
  if (dealTextNormalized.includes(normalizedGeo)) return true;
  for (const part of normalizedGeo.split(/\s+/)) {
    if (part.length >= 4 && dealTextNormalized.includes(part)) return true;
  }
  return false;
}

async function createDealFromLead(ctx: CopilotToolContext, input: z.infer<typeof CreateDealFromLeadArgs>) {
  const leadDossier = await getLeadDossier(ctx, input.leadId);
  if (!leadDossier.ok) return leadDossier;
  const lead = leadDossier.lead as Record<string, unknown>;
  const title = [lead.address, lead.city].filter(Boolean).join(", ") || String(lead.full_name ?? lead.company_name ?? "Nouveau deal");
  const contactName = [lead.full_name, lead.company_name].filter(Boolean).join(" - ") || null;
  const contactPhone = normalizePhone(String(lead.best_phone ?? ""));

  const { data: existing } = await ctx.sb.from("deals")
    .select("id,title,stage")
    .or(`title.ilike.%${sanitizeSearch(title)}%,address.ilike.%${sanitizeSearch(String(lead.address ?? ""))}%`)
    .not("stage", "in", '("cloture","abandonne")')
    .limit(1);
  if (existing?.[0]) return { ok: true, alreadyExists: true, deal: existing[0] };

  const preview = {
    title,
    stage: input.stage ?? "analyse",
    address: lead.address ?? null,
    units: lead.num_units ?? null,
    asking_price: lead.evaluation_total ?? null,
    temperature: "tiede",
    priority: "medium",
    contact_name: contactName,
    contact_phone: contactPhone || null,
  };

  if (!input.confirmed) {
    return { ok: true, requires_confirmation: true, preview, message: "Confirm with confirmed=true to create this deal." };
  }

  const { data, error } = await ctx.sb.from("deals").insert({
    ...preview,
    checklists: buildDefaultChecklists(preview.stage),
    notes_deal: `Créé via Copilot depuis lead ${input.leadId}.`,
    activities: [{ id: crypto.randomUUID(), text: `Deal créé depuis lead ${input.leadId}`, time: new Date().toISOString(), by: ctx.user.id }],
    assigned_to: ctx.user.id,
  }).select("id,title,stage").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, created: true, deal: data };
}

async function draftTextMessage(ctx: CopilotToolContext, input: z.infer<typeof DraftTextArgs>) {
  let target: Record<string, unknown> | null = null;
  let recentCalls: unknown[] = [];
  if (input.targetType === "deal") {
    const { data } = await ctx.sb.from("deals").select("id,title,contact_name,address,contact_phone,next_action,notes_vendeur,stage").eq("id", input.id).maybeSingle();
    target = data;
    if (data) {
      const { data: calls } = await ctx.sb
        .from("call_logs")
        .select("recorded_at,outcome,summary")
        .filter("raw->>deal_id", "eq", String(data.id))
        .order("recorded_at", { ascending: false })
        .limit(3);
      recentCalls = calls ?? [];
    }
  } else if (input.targetType === "lead") {
    const { data } = await ctx.sb.from("leads_view").select("lead_id,full_name,company_name,address,city,best_phone").eq("lead_id", input.id).maybeSingle();
    target = data;
  } else if (ctx.role === "admin") {
    const { data } = await ctx.sb.from("investors").select("id,full_name,firm_name,phone_e164,city,preferred_geography,ticket_size_min_cad,ticket_size_max_cad").eq("id", input.id).maybeSingle();
    target = data;
  }
  if (!target) return { ok: false, error: "Target not found or not allowed." };
  return {
    ok: true,
    targetType: input.targetType,
    purpose: input.purpose,
    target,
    recentCalls,
    guidance: "Write the SMS in the user's language, under 320 chars, friendly but professional, sign as Anthony from Socle Acquisitions. Do not send — just propose the text and ask the user to confirm.",
    warning: "Draft only. SMS is not sent by this tool.",
  };
}

function matchPath(path: string, pattern: RegExp) {
  const match = path.match(pattern);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function resolveDealReference(
  ctx: CopilotToolContext,
  reference: string,
  select = "*",
): Promise<{ ok: true; deal: Record<string, unknown>; matchedBy?: string; similarity?: number } | { ok: false; error: string; candidates?: unknown[] }> {
  // Always include the columns we need for scoring + display alongside whatever caller asked for.
  const requiredCols = ["id", "title", "stage", "address", "contact_name", "contact_phone", "updated_at", "activities"];
  const selectCols = mergeSelect(select, requiredCols);
  const ref = reference.trim();
  if (!ref) return { ok: false, error: "Deal reference is empty." };

  const currentPageDealId = matchPath(ctx.page.pathname ?? "", /^\/pipeline\/([^/?#]+)/);
  if (currentPageDealId && !isUuid(ref) && isWeakDealReference(ref)) {
    const { data, error } = await ctx.sb.from("deals").select(selectCols).eq("id", currentPageDealId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (data) return { ok: true, deal: data as unknown as Record<string, unknown> };
  }

  if (isUuid(ref)) {
    const { data, error } = await ctx.sb.from("deals").select(selectCols).eq("id", ref).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (data) return { ok: true, deal: data as unknown as Record<string, unknown> };
    return { ok: false, error: `Deal not found for id ${ref}.` };
  }

  const phone = normalizePhone(ref);
  const tokens = dealReferenceTokens(ref);

  // Pre-filter in SQL: phone match, or any strong token matches title/address/contact_name.
  // Falls back to a small recent slice if neither yields candidates.
  const orFilters: string[] = [];
  if (phone) orFilters.push(`contact_phone.ilike.%${phone}%`);
  for (const token of tokens.filter((t) => t.length >= 3).slice(0, 4)) {
    for (const variant of tokenSqlVariants(token)) {
      const safe = variant.replace(/[%_,()]/g, " ");
      orFilters.push(`title.ilike.%${safe}%`);
      orFilters.push(`address.ilike.%${safe}%`);
      orFilters.push(`contact_name.ilike.%${safe}%`);
    }
  }

  let query = ctx.sb
    .from("deals")
    .select(selectCols)
    .not("stage", "in", '("cloture","abandonne")')
    .order("updated_at", { ascending: false })
    .limit(80);
  if (orFilters.length > 0) query = query.or(orFilters.join(","));

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  // When the query contains a street number, weight address matches heavily
  // and dampen contact-name-only matches: "585 Rue Gouin" must beat "Pascal Gouin".
  const hasStreetNumber = tokens.some((t) => /^\d{2,5}$/.test(t));
  const scored = ((data ?? []) as unknown as Array<Record<string, unknown>>)
    .map((deal) => {
      const addressText = normalizeDealText(String(deal.title ?? "") + " " + String(deal.address ?? ""));
      const contactText = normalizeDealText(String(deal.contact_name ?? ""));
      let score = 0;
      if (phone && normalizePhone(String(deal.contact_phone ?? "")) === phone) score += 100;
      for (const token of tokens) {
        const inAddress = addressText.includes(token);
        const inContact = contactText.includes(token);
        if (inAddress) {
          score += hasStreetNumber ? 25 : (token.length >= 5 ? 14 : 8);
        } else if (inContact) {
          score += hasStreetNumber ? 2 : 8;
        }
      }
      return { deal, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (top && top.score >= 8) {
    const second = scored[1];
    if (second && second.score >= top.score - 4 && !isWeakDealReference(ref)) {
      return {
        ok: false,
        error: `Multiple deals matched "${reference}".`,
        candidates: scored.slice(0, 5).map((row) => ({
          id: row.deal.id,
          title: row.deal.title,
          address: row.deal.address,
          contact_name: row.deal.contact_name,
          score: row.score,
        })),
      };
    }
    return { ok: true, deal: top.deal };
  }

  // Fuzzy fallback: load a wider slice and trigram-rank for typo tolerance
  // ("Lavriere" -> "Laverriere", "Gouain" -> "Gouin", "Saint Hyasinte" -> "Saint-Hyacinthe").
  const { data: wide } = await ctx.sb
    .from("deals")
    .select(selectCols)
    .not("stage", "in", '("cloture","abandonne")')
    .order("updated_at", { ascending: false })
    .limit(400);
  const wideRows = (wide ?? []) as unknown as Array<Record<string, unknown>>;
  const fuzzy = fuzzyRankRows(wideRows, ref, ["title", "address", "contact_name"]).slice(0, 5);
  if (fuzzy.length === 0) {
    return { ok: false, error: `No active deal matched "${reference}". Try an address, seller name, phone, or open the deal page first.` };
  }
  const fz = fuzzy[0];
  if (fuzzy[1] && fuzzy[1].score >= fz.score - 0.05) {
    return {
      ok: false,
      error: `No exact deal match for "${reference}". Closest fuzzy candidates:`,
      candidates: fuzzy.map((f) => ({
        id: f.row.id,
        title: f.row.title,
        address: f.row.address,
        contact_name: f.row.contact_name,
        similarity: Number(f.score.toFixed(3)),
        matchedField: String(f.matchedField),
      })),
    };
  }
  return { ok: true, deal: fz.row, matchedBy: "fuzzy", similarity: Number(fz.score.toFixed(3)) };
}

async function resolveLeadReference(
  ctx: CopilotToolContext,
  reference: string,
): Promise<{ ok: true; lead: Record<string, unknown>; matchedBy?: string; similarity?: number } | { ok: false; error: string; candidates?: unknown[] }> {
  const ref = reference.trim();
  if (!ref) return { ok: false, error: "Lead reference is empty." };

  if (isUuid(ref)) {
    const { data, error } = await ctx.sb.from("leads_view").select("*").eq("lead_id", ref).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: `Lead not found for id ${ref}.` };
    const lead = data as unknown as Record<string, unknown>;
    if (ctx.role !== "admin" && lead.assigned_to !== ctx.user.id) return { ok: false, error: "Forbidden for this lead." };
    return { ok: true, lead };
  }

  const phone = normalizePhone(ref);
  const tokens = dealReferenceTokens(ref);
  const orFilters: string[] = [];
  if (phone) orFilters.push(`best_phone.ilike.%${phone}%`);
  for (const token of tokens.filter((t) => t.length >= 3).slice(0, 4)) {
    for (const variant of tokenSqlVariants(token)) {
      const safe = variant.replace(/[%_,()]/g, " ");
      orFilters.push(`full_name.ilike.%${safe}%`);
      orFilters.push(`company_name.ilike.%${safe}%`);
      orFilters.push(`address.ilike.%${safe}%`);
      orFilters.push(`city.ilike.%${safe}%`);
    }
  }

  let query = ctx.sb.from("leads_view").select("*").order("updated_at", { ascending: false }).limit(120);
  if (orFilters.length > 0) query = query.or(orFilters.join(","));
  if (ctx.role !== "admin") query = query.eq("assigned_to", ctx.user.id);
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const hasStreetNumber = tokens.some((t) => /^\d{2,5}$/.test(t));
  const scored = scoreRecords(rows, tokens, phone, {
    addressFields: ["address", "city"],
    contactFields: ["full_name", "company_name"],
    phoneField: "best_phone",
    hasStreetNumber,
  });

  const top = scored[0];
  if (top && top.score >= 8) {
    const second = scored[1];
    if (second && second.score >= top.score - 4) {
      return {
        ok: false,
        error: `Multiple leads matched "${reference}".`,
        candidates: scored.slice(0, 5).map((s) => ({
          id: s.row.lead_id,
          full_name: s.row.full_name,
          company_name: s.row.company_name,
          address: s.row.address,
          city: s.row.city,
          score: s.score,
        })),
      };
    }
    return { ok: true, lead: top.row };
  }

  // Fuzzy fallback for typos: load a wider slice and rank by trigram similarity.
  const wideQuery = ctx.role === "admin"
    ? ctx.sb.from("leads_view").select("*").order("updated_at", { ascending: false }).limit(400)
    : ctx.sb.from("leads_view").select("*").eq("assigned_to", ctx.user.id).order("updated_at", { ascending: false }).limit(400);
  const { data: wide } = await wideQuery;
  const wideRows = (wide ?? []) as unknown as Array<Record<string, unknown>>;
  const fuzzy = fuzzyRankRows(wideRows, ref, ["full_name", "company_name", "address", "city"]).slice(0, 5);
  if (fuzzy.length === 0) {
    return { ok: false, error: `No lead matched "${reference}". Try a full name, company, phone, or address.` };
  }
  const fz = fuzzy[0];
  if (fuzzy[1] && fuzzy[1].score >= fz.score - 0.05) {
    return {
      ok: false,
      error: `No exact lead match for "${reference}". Closest fuzzy candidates:`,
      candidates: fuzzy.map((f) => ({
        id: f.row.lead_id,
        full_name: f.row.full_name,
        company_name: f.row.company_name,
        address: f.row.address,
        city: f.row.city,
        similarity: Number(f.score.toFixed(3)),
        matchedField: String(f.matchedField),
      })),
    };
  }
  return { ok: true, lead: fz.row, matchedBy: "fuzzy", similarity: Number(fz.score.toFixed(3)) };
}

async function resolveInvestorReference(
  ctx: CopilotToolContext,
  reference: string,
): Promise<{ ok: true; investor: Record<string, unknown>; matchedBy?: string; similarity?: number } | { ok: false; error: string; candidates?: unknown[] }> {
  const ref = reference.trim();
  if (!ref) return { ok: false, error: "Investor reference is empty." };
  if (isUuid(ref)) {
    const { data, error } = await ctx.sb.from("investors").select("*").eq("id", ref).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: `Investor not found for id ${ref}.` };
    return { ok: true, investor: data as unknown as Record<string, unknown> };
  }
  const phone = normalizePhone(ref);
  const tokens = dealReferenceTokens(ref);
  const orFilters: string[] = [];
  if (phone) orFilters.push(`phone_e164.ilike.%${phone}%`);
  for (const token of tokens.filter((t) => t.length >= 3).slice(0, 4)) {
    for (const variant of tokenSqlVariants(token)) {
      const safe = variant.replace(/[%_,()]/g, " ");
      orFilters.push(`full_name.ilike.%${safe}%`);
      orFilters.push(`firm_name.ilike.%${safe}%`);
      orFilters.push(`preferred_geography.ilike.%${safe}%`);
    }
  }
  let query = ctx.sb.from("investors").select("*").order("updated_at", { ascending: false }).limit(120);
  if (orFilters.length > 0) query = query.or(orFilters.join(","));
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const scored = scoreRecords(rows, tokens, phone, {
    addressFields: ["preferred_geography"],
    contactFields: ["full_name", "firm_name"],
    phoneField: "phone_e164",
    hasStreetNumber: false,
  });
  const top = scored[0];
  if (top && top.score >= 8) {
    const second = scored[1];
    if (second && second.score >= top.score - 4) {
      return {
        ok: false,
        error: `Multiple investors matched "${reference}".`,
        candidates: scored.slice(0, 5).map((s) => ({
          id: s.row.id, full_name: s.row.full_name, firm_name: s.row.firm_name, preferred_geography: s.row.preferred_geography, score: s.score,
        })),
      };
    }
    return { ok: true, investor: top.row };
  }
  const { data: wide } = await ctx.sb.from("investors").select("*").order("updated_at", { ascending: false }).limit(400);
  const wideRows = (wide ?? []) as unknown as Array<Record<string, unknown>>;
  const fuzzy = fuzzyRankRows(wideRows, ref, ["full_name", "firm_name", "preferred_geography"]).slice(0, 5);
  if (fuzzy.length === 0) {
    return { ok: false, error: `No investor matched "${reference}".` };
  }
  const fz = fuzzy[0];
  if (fuzzy[1] && fuzzy[1].score >= fz.score - 0.05) {
    return {
      ok: false,
      error: `No exact investor match for "${reference}". Fuzzy candidates:`,
      candidates: fuzzy.map((f) => ({
        id: f.row.id, full_name: f.row.full_name, firm_name: f.row.firm_name, similarity: Number(f.score.toFixed(3)),
      })),
    };
  }
  return { ok: true, investor: fz.row, matchedBy: "fuzzy", similarity: Number(fz.score.toFixed(3)) };
}

function scoreRecords(
  rows: Array<Record<string, unknown>>,
  tokens: string[],
  phone: string,
  config: { addressFields: string[]; contactFields: string[]; phoneField: string; hasStreetNumber: boolean },
): Array<{ row: Record<string, unknown>; score: number }> {
  return rows
    .map((row) => {
      const addressText = normalizeDealText(config.addressFields.map((f) => String(row[f] ?? "")).join(" "));
      const contactText = normalizeDealText(config.contactFields.map((f) => String(row[f] ?? "")).join(" "));
      let score = 0;
      if (phone && normalizePhone(String(row[config.phoneField] ?? "")) === phone) score += 100;
      for (const token of tokens) {
        const inAddress = addressText.includes(token);
        const inContact = contactText.includes(token);
        if (inContact) {
          score += config.hasStreetNumber ? 2 : (token.length >= 5 ? 14 : 8);
        } else if (inAddress) {
          score += config.hasStreetNumber ? 25 : (token.length >= 5 ? 14 : 8);
        }
      }
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function getRecentActivity(
  ctx: CopilotToolContext,
  input: z.infer<typeof RecentActivityArgs>,
) {
  const hours = input.hours ?? 24;
  const limit = input.limit ?? 30;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const [deals, calls, sms, followUps, reviews] = await Promise.all([
    ctx.sb.from("deals")
      .select("id,title,stage,temperature,priority,assigned_to,updated_at,created_at,activities")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(40),
    ctx.sb.from("call_logs")
      .select("id,direction,outcome,duration_sec,recorded_at,summary,raw,lead_id")
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false })
      .limit(30),
    ctx.sb.from("automation_events")
      .select("id,event_type,payload,occurred_at")
      .in("event_type", ["sms_received", "sms_sent"])
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(30),
    ctx.sb.from("follow_ups")
      .select("id,lead_id,due_at,note,status,assigned_to,created_at,completed_at")
      .or(`created_at.gte.${since},completed_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(30),
    ctx.role === "admin"
      ? ctx.sb.from("review_items").select("id,title,urgency,status,created_at,resolved_at").gte("created_at", since).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  type TimelineEntry = { ts: string; type: string; summary: string; ref?: { type: string; id: string } };
  const timeline: TimelineEntry[] = [];

  for (const d of (deals.data ?? []) as Array<{ id: string; title: string | null; stage: string | null; temperature: string | null; updated_at: string; created_at: string; activities?: unknown }>) {
    const isNew = d.created_at >= since;
    timeline.push({
      ts: d.updated_at,
      type: isNew ? "deal_created" : "deal_updated",
      summary: `${isNew ? "Nouveau deal" : "Deal modifié"}: ${d.title ?? d.id} · ${d.stage ?? "?"} · ${d.temperature ?? "?"}`,
      ref: { type: "deal", id: d.id },
    });
    // Surface stage changes from activities (most recent only).
    const acts = Array.isArray(d.activities) ? d.activities as Array<{ time?: string; text?: string }> : [];
    for (const act of acts.slice(0, 3)) {
      if (act.time && act.text && String(act.time) >= since && /stade|stage/i.test(String(act.text))) {
        timeline.push({ ts: String(act.time), type: "deal_stage_move", summary: String(act.text), ref: { type: "deal", id: d.id } });
      }
    }
  }
  for (const c of (calls.data ?? []) as Array<{ id: string; direction: string | null; outcome: string | null; duration_sec: number | null; recorded_at: string; summary: string | null; lead_id: string | null }>) {
    timeline.push({
      ts: c.recorded_at,
      type: `call_${c.direction ?? "?"}`,
      summary: `Appel ${c.direction ?? ""} · ${c.outcome ?? "?"} · ${c.duration_sec ?? 0}s${c.summary ? ` · ${c.summary.slice(0, 120)}` : ""}`,
      ref: c.lead_id ? { type: "lead", id: c.lead_id } : undefined,
    });
  }
  for (const e of (sms.data ?? []) as Array<{ id: string; event_type: string; occurred_at: string; payload?: Record<string, unknown> | null }>) {
    const p = e.payload ?? {};
    timeline.push({
      ts: e.occurred_at,
      type: e.event_type,
      summary: `${e.event_type} ${p.from ? `from ${p.from}` : ""}${p.to ? ` to ${p.to}` : ""} · ${String(p.body ?? "").slice(0, 100)}`,
    });
  }
  for (const f of (followUps.data ?? []) as Array<{ id: string; lead_id: string | null; due_at: string; note: string; status: string; created_at: string; completed_at: string | null }>) {
    if (f.completed_at && f.completed_at >= since) {
      timeline.push({ ts: f.completed_at, type: "follow_up_completed", summary: `Suivi complété: ${f.note.slice(0, 100)}`, ref: f.lead_id ? { type: "lead", id: f.lead_id } : undefined });
    } else if (f.created_at >= since) {
      timeline.push({ ts: f.created_at, type: "follow_up_created", summary: `Suivi planifié pour ${f.due_at}: ${f.note.slice(0, 100)}`, ref: f.lead_id ? { type: "lead", id: f.lead_id } : undefined });
    }
  }
  for (const r of (reviews.data ?? []) as Array<{ id: string; title: string | null; urgency: string | null; status: string; created_at: string }>) {
    timeline.push({
      ts: r.created_at,
      type: "review_item_created",
      summary: `Review (${r.urgency ?? "?"}): ${r.title ?? r.id}`,
    });
  }

  timeline.sort((a, b) => b.ts.localeCompare(a.ts));

  return {
    ok: true,
    since,
    hours,
    count: timeline.length,
    timeline: timeline.slice(0, limit),
  };
}

async function getCrmCounts(
  ctx: CopilotToolContext,
  input: z.infer<typeof CrmCountsArgs>,
) {
  const table = input.entity === "deal" ? "deals" : input.entity === "lead" ? "leads_view" : "investors";
  if (input.entity === "investor" && ctx.role !== "admin") return { ok: false, error: "Admin only for investor counts." };

  let query = ctx.sb.from(table).select("*", { count: "exact", head: input.groupBy === "none" || !input.groupBy ? true : false }).limit(5000);

  const filters = input.filters ?? {};
  for (const [key, raw] of Object.entries(filters)) {
    if (raw === null || raw === undefined) continue;
    if (Array.isArray(raw)) {
      query = query.in(key, raw);
    } else {
      query = query.eq(key, raw as never);
    }
  }
  if (ctx.role !== "admin" && input.entity === "lead") {
    query = query.eq("assigned_to", ctx.user.id);
  }

  if (!input.groupBy || input.groupBy === "none") {
    const { count, error } = await query;
    if (error) return { ok: false, error: error.message };
    return { ok: true, entity: input.entity, total: count ?? 0, filters };
  }

  // For groupBy, fetch rows + count in JS. PostgREST doesn't natively GROUP BY.
  const groupCol = input.groupBy;
  const rowQuery = ctx.sb.from(table).select(`${groupCol}`).limit(5000);
  let rq = rowQuery;
  for (const [key, raw] of Object.entries(filters)) {
    if (raw === null || raw === undefined) continue;
    if (Array.isArray(raw)) rq = rq.in(key, raw);
    else rq = rq.eq(key, raw as never);
  }
  if (ctx.role !== "admin" && input.entity === "lead") rq = rq.eq("assigned_to", ctx.user.id);

  const { data: rows, error: rowErr } = await rq;
  if (rowErr) return { ok: false, error: rowErr.message };

  const buckets = new Map<string, number>();
  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    const key = String(row[groupCol] ?? "(null)");
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const grouped = Array.from(buckets.entries())
    .map(([key, value]) => ({ [groupCol]: key, count: value }))
    .sort((a, b) => b.count - a.count);
  return {
    ok: true,
    entity: input.entity,
    groupBy: groupCol,
    filters,
    total: grouped.reduce((s, g) => s + g.count, 0),
    buckets: grouped,
  };
}

// Best-effort natural-date parser as a safety net behind the LLM. The model
// is asked to produce ISO; this catches the cases where it slips and passes
// "5 mai" / "demain 10h" / "vendredi" / "in 3 days". All dates resolve to the
// next future occurrence in America/Toronto (Anthony's TZ).
function parseFlexibleDate(input: string): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  // Fast path: ISO or any Date-parseable string.
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(trimmed)) return direct;

  const now = new Date();
  const lower = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Extract optional time: "14h", "14h30", "2pm", "14:30", "10h00", "à 14h"
  let hour = 9;
  let minute = 0;
  const timeMatch = lower.match(/(?:a\s+)?(\d{1,2})\s*(?:h|:|am|pm)\s*(\d{0,2})\s*(am|pm)?/);
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3] ?? (lower.includes("pm") ? "pm" : lower.includes("am") ? "am" : null);
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }

  const setTime = (d: Date) => {
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  // "demain" / "tomorrow"
  if (/\b(demain|tomorrow)\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return setTime(d);
  }
  // "aujourd'hui" / "today" / "ce soir"
  if (/\b(aujourd hui|aujourdhui|today|ce soir|tonight)\b/.test(lower)) {
    return setTime(new Date(now));
  }
  // "dans X jours/semaines/heures" / "in X days/weeks/hours"
  const inMatch = lower.match(/\b(?:dans|in)\s+(\d+)\s*(jour|jours|semaine|semaines|heure|heures|day|days|week|weeks|hour|hours)\b/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const d = new Date(now);
    if (/heure|hour/.test(unit)) d.setHours(d.getHours() + n);
    else if (/semaine|week/.test(unit)) d.setDate(d.getDate() + n * 7);
    else d.setDate(d.getDate() + n);
    return /heure|hour/.test(unit) ? d : setTime(d);
  }
  // Day of week: "lundi", "mardi", "monday", "tuesday"... → next occurrence.
  const weekdays = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const weekdaysEn = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b(${weekdays[i]}|${weekdaysEn[i]})\\b`);
    if (re.test(lower)) {
      const d = new Date(now);
      const delta = ((i - d.getDay()) + 7) % 7 || 7;
      d.setDate(d.getDate() + delta);
      return setTime(d);
    }
  }
  // "5 mai" / "12 décembre" / "may 5" / "december 12"
  const months: Record<string, number> = {
    janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11,
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const monthRe = Object.keys(months).join("|");
  const dayMonth = lower.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthRe})(?:\\s+(\\d{4}))?`));
  const monthDay = lower.match(new RegExp(`\\b(${monthRe})\\s+(\\d{1,2})(?:\\s+(\\d{4}))?`));
  const m = dayMonth ?? monthDay;
  if (m) {
    const isDayFirst = !!dayMonth;
    const day = parseInt(isDayFirst ? m[1] : m[2], 10);
    const month = months[isDayFirst ? m[2] : m[1]];
    const year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    const d = new Date(year, month, day, hour, minute);
    // If date is in the past with no explicit year, roll to next year.
    if (!m[3] && d.getTime() < now.getTime()) d.setFullYear(year + 1);
    return d;
  }
  // Last resort: fall through if Date could parse it at all.
  if (!Number.isNaN(direct.getTime())) return direct;
  return null;
}

function mergeSelect(select: string, required: string[]) {
  if (select === "*" || !select.trim()) return "*";
  const cols = new Set(select.split(",").map((c) => c.trim()).filter(Boolean));
  for (const col of required) cols.add(col);
  return Array.from(cols).join(",");
}

function sanitizeSearch(value: string) {
  return value.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, " ").slice(0, 80);
}

function excerpt(value: string | null | undefined, max: number) {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function compactCall(row: unknown) {
  const call = row as Record<string, unknown>;
  return {
    ...call,
    transcript: untrusted(excerpt(String(call.transcript ?? ""), 900)),
    notes: untrusted(excerpt(String(call.notes ?? ""), 500)),
    summary: untrusted(excerpt(String(call.summary ?? ""), 600)),
  };
}

// Wrap raw user/3rd-party text so the model knows it is data, not instructions.
function untrusted(value: string | null) {
  if (!value) return null;
  return `<<UNTRUSTED>>${value}<<END>>`;
}

function appendBlock(existing: string, heading: string, body: string) {
  const block = `${heading}\n${body.trim()}`;
  return existing?.trim() ? `${existing.trim()}\n\n${block}` : block;
}

function splitTags(value: string) {
  return value.split(/[,;|]/).map((tag) => tag.trim()).filter(Boolean);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isWeakDealReference(value: string) {
  const normalized = normalizeDealText(value);
  const tokens = dealReferenceTokens(value);
  return normalized.includes("deal id")
    || normalized.includes("cette fiche")
    || normalized.includes("ce deal")
    || normalized.includes("current")
    || tokens.length <= 2;
}

const DEAL_STOPWORDS = new Set([
  // structural / placeholder
  "deal", "id", "fiche", "page", "current", "cette", "celui", "celle", "avec", "pour", "the",
  // French/English question + filler words
  "que", "qui", "quoi", "est", "se", "le", "la", "les", "un", "une", "des", "du",
  "et", "ou", "mais", "donc", "ni", "car", "passe", "il", "elle", "ils", "elles",
  "sur", "dans", "comme", "sans", "vers", "chez", "par", "what", "where", "with", "about", "tell",
  // street types \u2014 drop so they don't dilute scoring
  "rue", "boul", "boulevard", "av", "ave", "avenue", "chemin", "place", "route", "rang", "cote",
]);

function dealReferenceTokens(value: string) {
  return normalizeDealText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !DEAL_STOPWORDS.has(token));
}

// Expand a normalized token to all spelling variants the DB might store.
// SQL ilike has no notion of "St" == "Saint", so we OR the variants explicitly.
function tokenSqlVariants(token: string): string[] {
  if (token === "saint") return ["saint", "st"];
  if (token === "sainte") return ["sainte", "ste"];
  return [token];
}

// Normalize text for matching: strip accents, lowercase, collapse punctuation,
// and canonicalize Quebec naming variants (st/ste \u2192 saint/sainte) so we match
// both directions ("st jean" \u2194 "Saint-Jean").
function normalizeDealText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .replace(/\s+/g, " ")
    .trim();
}

function compactRows<T>(rows: T[], limit: number) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
