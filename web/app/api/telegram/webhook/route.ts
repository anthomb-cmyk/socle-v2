// POST /api/telegram/webhook — Telegram inbound webhook
//
// Pipeline:
//   1. Verify X-Telegram-Bot-Api-Secret-Token header matches TELEGRAM_WEBHOOK_SECRET.
//   2. Always log raw update to automation_events (so we have audit even if parse fails).
//   3. Identify sender via users_meta.telegram_user_id.
//   4. Run lightweight intent parsing.
//      - If confident: act + reply with confirmation.
//      - If uncertain: write command_inbox row + reply asking to clarify.
//   5. Reply via sendMessage.
//
// Intent set (Phase 2 minimum, add LLM-based parsing later):
//   - "/start"                            → register telegram_user_id, friendly help
//   - "Relance NAME [demain|today] HH"    → create follow-up if confident match
//   - "Note sur NAME: TEXT"               → append note (proposed_action — Anthony confirms)
//   - "Hot leads in CITY"                 → search + reply with top 5
//   - anything else                       → log + ask for clarification

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { sendTelegramAlert } from "@/lib/telegram";

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
}

export async function POST(request: Request) {
  // 1. Verify secret
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== expectedSecret) {
      return NextResponse.json({ ok: false, error: "Bad secret" }, { status: 401 });
    }
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  // 2. Always log raw update
  await sb.from("automation_events").insert({
    source: "telegram",
    event_type: "telegram_update_received",
    status: "started",
    payload: update,
    telegram_message_id: update.message?.message_id?.toString() ?? null,
  });

  const msg = update.message;
  if (!msg || !msg.text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const tgUserId = msg.from?.id?.toString();
  const text = msg.text.trim();
  const chatId = msg.chat.id.toString();

  // 3. Identify sender. Anthony is admin; everyone else is unauthorized for the bot
  // (we don't yet have a flow for cold callers to use Telegram).
  let userMeta: { user_id: string; role: string; display_name: string | null } | null = null;
  if (tgUserId) {
    const res = await sb.from("users_meta").select("user_id, role, display_name")
      .eq("telegram_user_id", tgUserId).maybeSingle();
    userMeta = (res.data ?? null) as typeof userMeta;
  }

  // /start handler — works for unidentified users; lets us link Telegram → user
  if (text === "/start" || text === "/help") {
    await reply(chatId,
      "👋 Salut! I'm the Socle CRM bot. Once Anthony links your Telegram to your CRM account, you can:\n" +
      "• ask 'qu'est-ce que je dois faire aujourd'hui?'\n" +
      "• create a follow-up: 'relance NAME demain 14h'\n" +
      "• add a note: 'note sur NAME: TEXT'\n" +
      "• search: 'hot leads in Granby'\n\n" +
      `Your Telegram user ID is *${tgUserId ?? "unknown"}*. Anthony: paste this into users_meta.telegram_user_id to link.`,
    );
    return NextResponse.json({ ok: true });
  }

  if (!userMeta) {
    await reply(chatId,
      `Sorry, I don't recognize this Telegram account yet. Anthony needs to link your account first. Your Telegram user ID is *${tgUserId ?? "unknown"}*.`,
    );
    await sb.from("automation_events").insert({
      source: "telegram", event_type: "telegram_unauthorized",
      status: "failed", payload: { tg_user_id: tgUserId, text },
    });
    return NextResponse.json({ ok: true });
  }

  // 4. Intent parsing — basic regex match. Anything not matched goes to command_inbox.
  // Pin userMeta non-null after the guard above to keep TS happy across awaits.
  const me: { user_id: string; role: string; display_name: string | null } = userMeta;
  const intent = parseIntent(text);

  switch (intent.kind) {
    case "follow_up": {
      // Confidence proxy: did we find a name + when? If yes → look up lead. If
      // 1 match → act. If 0 or many → command_inbox + ask Anthony.
      const candidates = await findLeadCandidates(sb, intent.name);
      if (candidates.length === 1) {
        const lead = candidates[0];
        await sb.from("follow_ups").insert({
          lead_id: lead.lead_id,
          due_at: intent.dueAt.toISOString(),
          note: text,
          source: "telegram",
          created_by: me.user_id,
          assigned_to: me.user_id,
          priority: 70,
        });
        await reply(chatId,
          `✅ Follow-up created\n*${lead.full_name ?? lead.company_name}*\n${intent.dueAt.toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" })}`,
        );
      } else {
        await sb.from("command_inbox").insert({
          source: "telegram",
          raw_message: text,
          parsed_intent: "follow_up",
          candidates: candidates as unknown as Record<string, unknown>,
          telegram_user_id: tgUserId ?? null,
          telegram_message_id: msg.message_id.toString(),
        });
        if (candidates.length === 0) {
          await reply(chatId, `No lead matches "${intent.name}". Saved to your command inbox to clarify in the CRM.`);
        } else {
          const list = candidates.slice(0, 5).map((c, i) => `${i + 1}. ${c.full_name ?? c.company_name} — ${c.city ?? "?"}`).join("\n");
          await reply(chatId, `Multiple matches for "${intent.name}":\n${list}\n\nWhich one? (Open Review Inbox to disambiguate.)`);
        }
      }
      break;
    }

    case "search": {
      const { data: leads } = await sb.from("leads_view")
        .select("address, city, full_name, company_name, status, best_phone, num_units")
        .ilike("city", `%${intent.city}%`)
        .limit(5);
      if (!leads || leads.length === 0) {
        await reply(chatId, `No leads found in ${intent.city}.`);
      } else {
        const lines = (leads as Array<{ address: string; full_name: string | null; company_name: string | null; status: string; num_units: number | null }>)
          .map((l, i) => `${i + 1}. ${l.full_name ?? l.company_name} — ${l.address}${l.num_units ? ` (${l.num_units}u)` : ""} — ${l.status}`).join("\n");
        await reply(chatId, `Top leads in ${intent.city}:\n${lines}`);
      }
      break;
    }

    case "note": {
      // Notes are sensitive — we propose, Anthony confirms via review.
      const candidates = await findLeadCandidates(sb, intent.name);
      if (candidates.length === 1) {
        await sb.from("proposed_actions").insert({
          action_type: "append_note",
          target_table: "leads",
          target_id: candidates[0].lead_id,
          proposed_change: { append: intent.text },
          rationale: `Telegram note from ${me.display_name}`,
          confidence: 70,
          source: "telegram",
        });
        await reply(chatId, `📝 Note proposed for *${candidates[0].full_name ?? candidates[0].company_name}*. Will appear in your review inbox to confirm.`);
      } else {
        await sb.from("command_inbox").insert({
          source: "telegram", raw_message: text, parsed_intent: "note",
          candidates: candidates as unknown as Record<string, unknown>,
          telegram_user_id: tgUserId, telegram_message_id: msg.message_id.toString(),
        });
        await reply(chatId, candidates.length === 0
          ? `No lead matches "${intent.name}". Saved to command inbox.`
          : `Multiple matches — saved to command inbox to disambiguate.`);
      }
      break;
    }

    case "today": {
      const { data: fups } = await sb.from("follow_ups")
        .select("id, due_at, note, lead_id")
        .eq("status", "pending")
        .lte("due_at", new Date(Date.now() + 24 * 3600_000).toISOString())
        .order("due_at");
      const { data: openItems } = await sb.from("review_items")
        .select("id, title, urgency").eq("status", "open").eq("urgency", "urgent");
      const fupCount = fups?.length ?? 0;
      const reviewCount = openItems?.length ?? 0;
      await reply(chatId,
        `*Today*\n• ${fupCount} follow-up${fupCount === 1 ? "" : "s"} due/overdue\n• ${reviewCount} urgent review item${reviewCount === 1 ? "" : "s"}`,
      );
      break;
    }

    case "unknown":
    default: {
      await sb.from("command_inbox").insert({
        source: "telegram", raw_message: text, parsed_intent: "unknown",
        telegram_user_id: tgUserId, telegram_message_id: msg.message_id.toString(),
      });
      await reply(chatId,
        "Hmm, I didn't recognize that. Try:\n" +
        "• `relance NAME demain 14h`\n" +
        "• `note sur NAME: TEXT`\n" +
        "• `hot leads in Granby`\n" +
        "• `today`",
      );
    }
  }

  // 5. Mark the original event as completed
  return NextResponse.json({ ok: true });
}

// ─── helpers ─────────────────────────────────────────────────────────────

async function reply(chatId: string, text: string) {
  await sendTelegramAlert(text, { chatId });
}

async function findLeadCandidates(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  name: string,
): Promise<Array<{ lead_id: string; full_name: string | null; company_name: string | null; city: string | null }>> {
  const { data } = await sb.from("leads_view")
    .select("lead_id, full_name, company_name, city")
    .or(`full_name.ilike.%${name}%,company_name.ilike.%${name}%`)
    .limit(10);
  return (data ?? []) as Array<{ lead_id: string; full_name: string | null; company_name: string | null; city: string | null }>;
}

type Intent =
  | { kind: "follow_up"; name: string; dueAt: Date }
  | { kind: "search"; city: string }
  | { kind: "note"; name: string; text: string }
  | { kind: "today" }
  | { kind: "unknown" };

function parseIntent(text: string): Intent {
  const lower = text.toLowerCase();

  // "today" / "qu'est-ce que je dois faire aujourd'hui"
  if (/^(today|aujourd['’]?hui|qu['’]?est[\s\-]?ce|whats? on)\b/i.test(text) || /quoi.*aujourd/i.test(lower)) {
    return { kind: "today" };
  }

  // "hot leads in CITY" / "leads à CITY"
  let m = text.match(/(?:hot leads in|leads in|leads à|leads dans)\s+([A-Za-zÀ-ÿ\-']+(?:\s[A-Za-zÀ-ÿ\-']+)?)/i);
  if (m) return { kind: "search", city: m[1].trim() };

  // "note sur NAME: TEXT" / "note for NAME: TEXT"
  m = text.match(/^note\s+(?:sur|for|on)\s+([A-Za-zÀ-ÿ0-9\s\-'\.]+?):\s*(.+)$/i);
  if (m) return { kind: "note", name: m[1].trim(), text: m[2].trim() };

  // "relance NAME demain 14h" / "follow up with NAME tomorrow 10am"
  m = text.match(/^(?:relance|follow[\s\-]?up\s+(?:with)?)\s+([A-Za-zÀ-ÿ0-9\s\-'\.]+?)\s+(demain|tomorrow|aujourd['’]?hui|today|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:à|at)?\s*(\d{1,2})\s*(?:h|am|pm|:)?(\d{2})?\s*(am|pm)?)?\s*$/i);
  if (m) {
    const name = m[1].trim();
    const day = m[2].toLowerCase();
    const hour = m[3] ? parseInt(m[3], 10) : 10;
    const min = m[4] ? parseInt(m[4], 10) : 0;
    const ampm = m[5]?.toLowerCase();
    let h = hour;
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;

    const due = new Date();
    if (/(demain|tomorrow)/i.test(day)) due.setDate(due.getDate() + 1);
    else if (/(aujourd|today)/i.test(day)) { /* same day */ }
    else {
      // weekday → next occurrence
      const map: Record<string, number> = {
        dimanche: 0, sunday: 0, lundi: 1, monday: 1, mardi: 2, tuesday: 2,
        mercredi: 3, wednesday: 3, jeudi: 4, thursday: 4,
        vendredi: 5, friday: 5, samedi: 6, saturday: 6,
      };
      const target = map[day];
      if (target !== undefined) {
        const diff = (target - due.getDay() + 7) % 7 || 7;
        due.setDate(due.getDate() + diff);
      }
    }
    due.setHours(h, min, 0, 0);
    return { kind: "follow_up", name, dueAt: due };
  }

  return { kind: "unknown" };
}
