// Minimal Telegram client. Server-only — uses TELEGRAM_BOT_TOKEN.
//
// We do not pull in grammY for the slice — the only outbound action we need
// is sendMessage. grammY can be wired later when we accept inbound webhooks.

const API = "https://api.telegram.org";

export type TelegramResult =
  | { ok: true; message_id: string }
  | { ok: false; error: string };

/** @deprecated Use sendTelegramAlert which now returns TelegramResult */
export interface SendResult {
  message_id: string;
}

export async function sendTelegramAlert(
  text: string,
  options: { chatId?: string; parseMode?: "Markdown" | "MarkdownV2" | "HTML" } = {},
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId ?? process.env.TELEGRAM_ANTHONY_CHAT_ID;
  if (!token) {
    const msg = "TELEGRAM_BOT_TOKEN not set";
    console.warn(`[telegram] ${msg}`);
    return { ok: false, error: msg };
  }
  if (!chatId) {
    const msg = "TELEGRAM_ANTHONY_CHAT_ID not set — send /start to bot to get your chat ID";
    console.warn(`[telegram] ${msg}`);
    return { ok: false, error: msg };
  }

  // Build request body — omit parse_mode entirely when not explicitly set so
  // Telegram treats the message as plain text. User-entered content (names,
  // addresses, notes) is not safe to pass through any Markdown parser.
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (options.parseMode) {
    body.parse_mode = options.parseMode;
  }

  try {
    const resp = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!json.ok) {
      const msg = `Telegram API error ${json.error_code}: ${json.description}`;
      console.error("[telegram] sendMessage failed:", json);
      return { ok: false, error: msg };
    }
    return { ok: true, message_id: String(json.result.message_id) };
  } catch (err) {
    const msg = `sendMessage threw: ${String(err)}`;
    console.error("[telegram] sendMessage error:", err);
    return { ok: false, error: msg };
  }
}
