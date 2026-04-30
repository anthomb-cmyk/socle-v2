// POST /api/telegram/setup — admin-only one-shot to register the Telegram webhook.
//
// Generates a secret if not set, stores it (well, instructs admin to store
// it in env), and calls Telegram's setWebhook with our public URL.
//
// Body: { publicUrl: string }   — e.g. "https://yourapp.vercel.app"
//                                 or for local dev: an ngrok URL.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";

const Body = z.object({ publicUrl: z.string().url() });

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token) return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });
  if (!secret || secret.startsWith("__")) {
    return NextResponse.json({
      ok: false,
      error: "TELEGRAM_WEBHOOK_SECRET not set. Generate a random string (e.g. `openssl rand -hex 32`), put it in .env.local as TELEGRAM_WEBHOOK_SECRET=..., restart the dev server, then call this endpoint again.",
    }, { status: 500 });
  }

  let body;
  try { body = Body.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false, error: "Bad input — provide { publicUrl }" }, { status: 400 }); }

  const webhookUrl = `${body.publicUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      drop_pending_updates: true,
      allowed_updates: ["message"],
    }),
  });
  const json = await resp.json();
  return NextResponse.json({ ok: !!json.ok, telegram: json, webhookUrl });
}
