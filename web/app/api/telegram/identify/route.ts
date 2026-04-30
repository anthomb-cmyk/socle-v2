// GET /api/telegram/identify
// One-shot helper for discovering Anthony's Telegram chat ID. Hit this AFTER
// you've sent /start to your bot. It calls getUpdates and returns the most
// recent chat IDs so you can paste TELEGRAM_ANTHONY_CHAT_ID into .env.local.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });

  const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const json = await resp.json();
  if (!json.ok) return NextResponse.json({ ok: false, error: "Telegram getUpdates failed", raw: json }, { status: 500 });

  const chats = (json.result as Array<{ message?: { chat: { id: number; first_name?: string; username?: string }; text?: string } }>)
    .map(u => u.message?.chat).filter(Boolean) as { id: number; first_name?: string; username?: string }[];
  const distinct = [...new Map(chats.map(c => [c.id, c])).values()];

  return NextResponse.json({
    ok: true,
    chats: distinct,
    instructions: distinct.length === 0
      ? "Open Telegram, search your bot by its username, send /start. Then refresh this endpoint."
      : `Found ${distinct.length} chat(s). Add to .env.local: TELEGRAM_ANTHONY_CHAT_ID=${distinct[0].id}`,
  });
}
