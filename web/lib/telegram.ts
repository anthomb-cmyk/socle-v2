// Minimal Telegram client. Server-only — uses TELEGRAM_BOT_TOKEN.
//
// We do not pull in grammY for the slice — the only outbound action we need
// is sendMessage. grammY can be wired later when we accept inbound webhooks.

const API = "https://api.telegram.org";

export interface SendResult {
  message_id: string;
}

export async function sendTelegramAlert(
  text: string,
  options: { chatId?: string; parseMode?: "Markdown" | "MarkdownV2" | "HTML" } = {},
): Promise<SendResult | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId ?? process.env.TELEGRAM_ANTHONY_CHAT_ID;
  if (!token) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not set — alert not sent.");
    return null;
  }
  if (!chatId) {
    console.warn("[telegram] TELEGRAM_ANTHONY_CHAT_ID not set — alert not sent. Send /start to your bot first to discover the chat ID.");
    return null;
  }

  try {
    const resp = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parseMode ?? "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const json = await resp.json();
    if (!json.ok) {
      console.error("[telegram] sendMessage failed:", json);
      return null;
    }
    return { message_id: String(json.result.message_id) };
  } catch (err) {
    console.error("[telegram] sendMessage error:", err);
    return null;
  }
}
