// POST /api/chat
//
// Socle Copilot: CRM-aware assistant with safe tool access.
// Body: {
//   messages: { role: "user" | "assistant"; content: string }[],
//   context?: { pathname?: string; href?: string }
// }

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { autoLinkRecentInboundCallsToDeals } from "@/lib/copilot/auto-link-calls";
import { COPILOT_TOOLS, runCopilotTool, type CopilotPageContext } from "@/lib/copilot/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

const SYSTEM_PROMPT = `You are Socle Copilot, the intelligent operational assistant embedded inside Socle CRM.

Language:
- Reply in the same language the user used.
- Anthony often mixes French and English; mirror him naturally.

Mission:
- You understand the CRM data, not just the app documentation.
- Use tools whenever the user asks about actual CRM state, a page, a lead, a deal, a call, an investor, a follow-up, or today's work.
- Be concise, practical, and action-oriented.

CRM scope:
- Socle acquires Quebec multifamily buildings.
- Core objects: leads, contacts, properties, phones, call_logs, transcripts, follow_ups, review_items, deals, investors, investor_deals, SMS automation events.
- Pipeline stages: prospection, analyse, offre, due_diligence, financement, cloture, abandonne.

Important behavior:
- Incoming calls that match a deal by seller phone are automatically linked by the system. Do not ask permission for that maintenance task.
- Before answering about a current page, call get_current_page_context.
- For questions like "what should I do next?", inspect the relevant dossier and give a prioritized answer.
- For deal work, separate building facts, seller motivation, price/terms, risks, and next action.
- For cold caller workflow, focus on what helps the caller act now.

Safety:
- Read-only tools are always allowed.
- Saving a note, scheduling a follow-up, or moving a deal stage is allowed when the user clearly asks.
- Creating a deal from a lead requires confirmation unless the user already explicitly confirmed.
- Never send SMS, delete records, reject/approve important review items, or perform bulk destructive actions unless a dedicated confirmed tool exists and the user explicitly confirms.
- If a requested action is not implemented as a tool, explain that clearly and offer the closest safe next step.

Output:
- When you used tools, summarize the result; do not dump raw JSON.
- If an action succeeded, say exactly what changed and where.
- If data is missing, say "je ne vois pas cette donnée" / "I don't see that data", never invent it.`;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;

  let body: { messages?: ClientMessage[]; context?: CopilotPageContext };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = sanitizeMessages(body.messages ?? []);
  if (!messages.length) {
    return NextResponse.json({ ok: false, error: "No messages provided" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "OPENAI_API_KEY not configured" }, { status: 503 });
  }

  const sb = createSupabaseAdminClient();
  const autoLinked = await autoLinkRecentInboundCallsToDeals(sb, {
    limit: 100,
    source: "socle_copilot_preflight",
    triggeredBy: user.id,
  }).catch(() => []);

  const page = {
    pathname: typeof body.context?.pathname === "string" ? body.context.pathname : "",
    href: typeof body.context?.href === "string" ? body.context.href : "",
  };

  const openai = new OpenAI({ apiKey });
  const model = process.env.SOCLE_COPILOT_MODEL?.trim()
    || process.env.OPENAI_CHAT_MODEL?.trim()
    || "gpt-4o";

  const modelMessages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: [
        `Current user id: ${user.id}`,
        `Current user role: ${role}`,
        `Current CRM path: ${page.pathname || "/"}`,
        page.href ? `Current URL: ${page.href}` : null,
        autoLinked.length
          ? `Preflight maintenance: auto-linked ${autoLinked.length} inbound call(s) to pipeline deals: ${JSON.stringify(autoLinked)}`
          : "Preflight maintenance: no unlinked inbound deal calls found.",
      ].filter(Boolean).join("\n"),
    },
    ...messages,
  ];

  try {
    for (let step = 0; step < 6; step++) {
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.2,
        max_tokens: 1100,
        messages: modelMessages as never,
        tools: COPILOT_TOOLS as never,
        tool_choice: "auto",
      });

      const msg = completion.choices[0]?.message;
      if (!msg) return NextResponse.json({ ok: false, error: "No model response" }, { status: 502 });

      const toolCalls = (msg.tool_calls ?? []).filter((call) => call.type === "function");
      if (toolCalls.length === 0) {
        return NextResponse.json({
          ok: true,
          reply: msg.content?.trim() ?? "",
          model,
          autoLinked,
        });
      }

      modelMessages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        })),
      });

      for (const call of toolCalls) {
        let result: unknown;
        try {
          result = await runCopilotTool(call.function.name, call.function.arguments, {
            sb,
            user,
            role,
            page,
          });
        } catch (err) {
          result = { ok: false, error: (err as Error).message };
        }

        modelMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: truncateToolResult(result),
        });
      }
    }

    return NextResponse.json({ ok: false, error: "Tool loop limit reached" }, { status: 502 });
  } catch (err) {
    const msg = (err as Error).message ?? "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

function sanitizeMessages(messages: ClientMessage[]) {
  return messages
    .filter((m): m is ClientMessage =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0,
    )
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
}

function truncateToolResult(value: unknown) {
  const text = JSON.stringify(value);
  return text.length > 14000 ? `${text.slice(0, 14000)}...` : text;
}
