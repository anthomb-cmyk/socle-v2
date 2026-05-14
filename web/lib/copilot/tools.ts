import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth";
import { buildDefaultChecklists } from "@/lib/deals/defaults";
import { normalizePhone } from "@/lib/twilio";
import { autoLinkRecentInboundCallsToDeals } from "./auto-link-calls";

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
      description: "Fetch a pipeline deal dossier: deal fields, notes, recent calls/transcripts, SMS events, documents, and linked investors.",
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
      description: "Fetch a lead dossier: owner, property, phones, calls, follow-ups, submissions, and events.",
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
      description: "Fetch an investor dossier with investor profile, notes, calls, and linked deals. Admin only.",
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
      description: "Create a follow-up for a lead/contact, or set next_action on a deal. Use only when the user asks for a reminder/follow-up.",
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
      description: "Move a pipeline deal to another stage. Ask for confirmation before using if the user did not explicitly command the move.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
          stage: { type: "string", enum: VALID_DEAL_STAGES },
          reason: { type: "string" },
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
  const q = sanitizeSearch(input.query);
  const digits = input.query.replace(/\D/g, "");
  const pattern = `%${q}%`;
  const phone = normalizePhone(input.query);

  const [deals, leads, investors, contacts, calls] = await Promise.all([
    ctx.sb.from("deals")
      .select("id,title,stage,address,units,asking_price,temperature,contact_name,contact_phone,updated_at")
      .or(`title.ilike.${pattern},address.ilike.${pattern},contact_name.ilike.${pattern}`)
      .order("updated_at", { ascending: false })
      .limit(limit),
    ctx.sb.from("leads_view")
      .select("lead_id,full_name,company_name,address,city,best_phone,status,priority,updated_at")
      .or(`full_name.ilike.${pattern},company_name.ilike.${pattern},address.ilike.${pattern},city.ilike.${pattern},best_phone.ilike.${pattern}`)
      .order("updated_at", { ascending: false })
      .limit(limit),
    ctx.role === "admin"
      ? ctx.sb.from("investors")
          .select("id,full_name,firm_name,email,phone_e164,city,status,preferred_geography,asset_class_focus,updated_at")
          .or(`full_name.ilike.${pattern},firm_name.ilike.${pattern},preferred_geography.ilike.${pattern},asset_class_focus.ilike.${pattern},notes.ilike.${pattern}`)
          .order("updated_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] }),
    ctx.sb.from("contacts")
      .select("id,full_name,company_name,kind,updated_at")
      .or(`full_name.ilike.${pattern},company_name.ilike.${pattern}`)
      .order("updated_at", { ascending: false })
      .limit(limit),
    q || phone || digits
      ? ctx.sb.from("call_logs")
          .select("id,direction,recorded_at,duration_sec,outcome,notes,summary,transcript,raw")
          .or(`notes.ilike.${pattern},summary.ilike.${pattern},transcript.ilike.${pattern}`)
          .order("recorded_at", { ascending: false })
          .limit(Math.min(limit, 5))
      : Promise.resolve({ data: [] }),
  ]);

  const phoneMatchedDeals = phone
    ? ((deals.data ?? []) as Array<{ contact_phone?: string | null }>).filter((deal) => normalizePhone(deal.contact_phone ?? "") === phone)
    : [];

  return {
    ok: true,
    query: input.query,
    results: {
      deals: compactRows([...phoneMatchedDeals, ...((deals.data ?? []) as unknown[])], limit),
      leads: leads.data ?? [],
      investors: investors.data ?? [],
      contacts: contacts.data ?? [],
      calls: ((calls.data ?? []) as Array<{ transcript?: string | null; notes?: string | null; summary?: string | null }>)
        .map((call) => ({
          ...call,
          transcript: excerpt(call.transcript, 700),
          notes: excerpt(call.notes, 400),
          summary: excerpt(call.summary, 500),
        })),
    },
  };
}

async function getDealDossier(ctx: CopilotToolContext, dealId: string) {
  const { data: deal, error } = await ctx.sb
    .from("deals")
    .select("id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,contact_phone,contact_email,notes_deal,notes_vendeur,ai_analysis,next_action,checklists,activities,lat,lng,created_at,updated_at")
    .eq("id", dealId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!deal) return { ok: false, error: "Deal not found." };

  const dealPhone = normalizePhone(String((deal as { contact_phone?: string | null }).contact_phone ?? ""));
  const [docs, rawDealCalls, phoneCalls, linkedInvestors, smsEvents] = await Promise.all([
    ctx.sb.from("deal_documents").select("id,name,size,mime_type,created_at").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(10),
    ctx.sb.from("call_logs")
      .select("id,direction,outcome,notes,summary,recorded_at,duration_sec,transcript_status,transcript,raw")
      .filter("raw->>deal_id", "eq", dealId)
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
          .eq("pipeline_deal_id", dealId)
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
      if (String(payload.dealId ?? payload.deal_id ?? "") === dealId) return true;
      if (!dealPhone) return false;
      return normalizePhone(String(payload.from ?? "")) === dealPhone || normalizePhone(String(payload.to ?? "")) === dealPhone;
    })
    .slice(0, 12);

  return {
    ok: true,
    type: "deal_dossier",
    deal,
    documents: docs.data ?? [],
    calls: Array.from(callsById.values()),
    sms,
    linkedInvestors: linkedInvestors.data ?? [],
  };
}

async function getLeadDossier(ctx: CopilotToolContext, leadId: string) {
  const { data: lead, error } = await ctx.sb.from("leads_view").select("*").eq("lead_id", leadId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!lead) return { ok: false, error: "Lead not found." };

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

  return {
    ok: true,
    date: now.toISOString(),
    followUps: followUps.data ?? [],
    urgentReviews: urgentReviews.data ?? [],
    readyLeads: readyLeads.data ?? [],
    hotDeals: hotDeals.data ?? [],
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
  return {
    ok: true,
    staleCutoff,
    stale: deals.filter((deal) => String(deal.updated_at ?? "") < staleCutoff),
    missingNextAction: deals.filter((deal) => !deal.next_action),
    missingSellerPhone: deals.filter((deal) => !normalizePhone(deal.contact_phone ?? "")),
    missingSellerNotes: deals.filter((deal) => !deal.notes_vendeur),
  };
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
    const { data: deal } = await ctx.sb.from("deals").select(`${field},activities`).eq("id", input.id).maybeSingle();
    if (!deal) return { ok: false, error: "Deal not found." };
    const existing = String((deal as Record<string, unknown>)[field] ?? "");
    const activities = Array.isArray((deal as { activities?: unknown }).activities) ? (deal as { activities: unknown[] }).activities : [];
    const { error } = await ctx.sb.from("deals").update({
      [field]: appendBlock(existing, stamp, input.note),
      activities: [{ id: crypto.randomUUID(), text: `Note ajoutée via Copilot (${field})`, time: new Date().toISOString(), by: ctx.user.id }, ...activities],
      updated_at: new Date().toISOString(),
    }).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, targetType: "deal", id: input.id, field, appended: true };
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
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime())) return { ok: false, error: "Invalid dueAt." };

  if (input.targetType === "deal") {
    const { data: deal } = await ctx.sb.from("deals").select("activities").eq("id", input.id).maybeSingle();
    if (!deal) return { ok: false, error: "Deal not found." };
    const activities = Array.isArray(deal.activities) ? deal.activities : [];
    const { error } = await ctx.sb.from("deals").update({
      next_action: `${due.toLocaleString("fr-CA")} · ${input.note}`,
      activities: [{ id: crypto.randomUUID(), text: `Suivi planifié: ${input.note} (${due.toISOString()})`, time: new Date().toISOString(), by: ctx.user.id }, ...activities],
      updated_at: new Date().toISOString(),
    }).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, targetType: "deal", id: input.id, nextAction: true };
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
  const { data: deal } = await ctx.sb.from("deals").select("activities,stage,title").eq("id", input.dealId).maybeSingle();
  if (!deal) return { ok: false, error: "Deal not found." };
  const activities = Array.isArray(deal.activities) ? deal.activities : [];
  const text = `Stade changé via Copilot: ${deal.stage} → ${input.stage}${input.reason ? ` · ${input.reason}` : ""}`;
  const { error } = await ctx.sb.from("deals").update({
    stage: input.stage,
    activities: [{ id: crypto.randomUUID(), text, time: new Date().toISOString(), by: ctx.user.id }, ...activities],
    updated_at: new Date().toISOString(),
  }).eq("id", input.dealId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, dealId: input.dealId, previousStage: deal.stage, stage: input.stage };
}

async function matchInvestorsToDeal(ctx: CopilotToolContext, input: z.infer<typeof MatchInvestorsArgs>) {
  if (ctx.role !== "admin") return { ok: false, error: "Admin only." };
  const limit = input.limit ?? 8;
  const [dealRes, investorsRes] = await Promise.all([
    ctx.sb.from("deals").select("id,title,address,units,asking_price,offer_price,temperature,priority").eq("id", input.dealId).maybeSingle(),
    ctx.sb.from("investors").select("id,full_name,firm_name,status,capital_available_cad,ticket_size_min_cad,ticket_size_max_cad,preferred_geography,asset_class_focus,notes").eq("status", "active").limit(500),
  ]);
  if (!dealRes.data) return { ok: false, error: "Deal not found." };
  const deal = dealRes.data;
  const price = Number(deal.offer_price ?? deal.asking_price ?? 0);
  const dealText = [deal.title, deal.address].filter(Boolean).join(" ").toLowerCase();
  const ranked = ((investorsRes.data ?? []) as Array<Record<string, unknown>>).map((inv) => {
    let score = 0;
    const reasons: string[] = [];
    for (const geo of splitTags(String(inv.preferred_geography ?? ""))) {
      if (dealText.includes(geo.toLowerCase())) {
        score += 35;
        reasons.push(`géo: ${geo}`);
        break;
      }
    }
    const min = Number(inv.ticket_size_min_cad ?? 0);
    const max = Number(inv.ticket_size_max_cad ?? 0);
    if (price > 0 && (!min || price >= min) && (!max || price <= max)) {
      score += 30;
      reasons.push("ticket overlap");
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
    return { investor: inv, score, reasons };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  return { ok: true, deal, matches: ranked };
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
  if (input.targetType === "deal") {
    const { data } = await ctx.sb.from("deals").select("id,title,contact_name,address,contact_phone,next_action").eq("id", input.id).maybeSingle();
    target = data;
  } else if (input.targetType === "lead") {
    const { data } = await ctx.sb.from("leads_view").select("lead_id,full_name,company_name,address,city,best_phone").eq("lead_id", input.id).maybeSingle();
    target = data;
  } else if (ctx.role === "admin") {
    const { data } = await ctx.sb.from("investors").select("id,full_name,firm_name,phone_e164,city").eq("id", input.id).maybeSingle();
    target = data;
  }
  if (!target) return { ok: false, error: "Target not found or not allowed." };
  const name = String(target.contact_name ?? target.full_name ?? "").split(/\s+/)[0] || "Bonjour";
  const place = [target.address, target.city, target.title].filter(Boolean)[0];
  return {
    ok: true,
    target,
    draft: `${name}, c'est Anthony de Socle Acquisitions. Je te texte au sujet de ${place ?? "votre immeuble"}. ${input.purpose} Est-ce qu'on peut se parler 5 minutes aujourd'hui ?`,
    warning: "Draft only. It has not been sent.",
  };
}

function matchPath(path: string, pattern: RegExp) {
  const match = path.match(pattern);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
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
    transcript: excerpt(String(call.transcript ?? ""), 900),
    notes: excerpt(String(call.notes ?? ""), 500),
    summary: excerpt(String(call.summary ?? ""), 600),
  };
}

function appendBlock(existing: string, heading: string, body: string) {
  const block = `${heading}\n${body.trim()}`;
  return existing?.trim() ? `${existing.trim()}\n\n${block}` : block;
}

function splitTags(value: string) {
  return value.split(/[,;|]/).map((tag) => tag.trim()).filter(Boolean);
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
