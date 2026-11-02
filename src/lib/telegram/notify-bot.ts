/**
 * Loki's notification bot — the one bot every Loki account can connect to.
 *
 * WHY A SECOND BOT. The owner's existing bot (TELEGRAM_BOT_TOKEN) carries his
 * conversation with OpenClaw, and Telegram gives a bot exactly ONE consumer of
 * its incoming messages. Linking a person needs Loki to see the moment they
 * press Start, so the notification bot's incoming messages come to Loki
 * (POST /api/telegram/webhook) and its only job is: link, unlink, deliver.
 *
 * Setup is one step for the operator: create a bot with @BotFather and set
 * TELEGRAM_NOTIFY_BOT_TOKEN and TELEGRAM_NOTIFY_BOT_USERNAME on the app. The
 * webhook registers itself the first time someone taps "Connect Telegram".
 * Until then Settings says Telegram is not set up here, and the operator's
 * own chat keeps working through the old bot.
 */
import { createHmac } from "node:crypto";
import { APP_URL } from "@/config/brand";

const API = "https://api.telegram.org";

export function notifyBotToken(): string | null {
  return process.env.TELEGRAM_NOTIFY_BOT_TOKEN?.trim() || null;
}

export function notifyBotUsername(): string | null {
  return process.env.TELEGRAM_NOTIFY_BOT_USERNAME?.trim().replace(/^@/, "") || null;
}

export function notifyBotConfigured(): boolean {
  return Boolean(notifyBotToken() && notifyBotUsername());
}

/**
 * Telegram echoes this in X-Telegram-Bot-Api-Secret-Token on every webhook
 * call, so the route can refuse anything Telegram did not send. Derived from
 * AUTH_SECRET: nothing new to configure, and it rotates with it.
 */
export function webhookSecret(): string {
  const base = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  return createHmac("sha256", base).update("telegram-notify-webhook").digest("hex").slice(0, 48);
}

export function startLink(code: string): string | null {
  const bot = notifyBotUsername();
  return bot ? `https://t.me/${bot}?start=${code}` : null;
}

export async function callBot<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = notifyBotToken();
  if (!token) return { ok: false, description: "notify bot not configured" };
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return (await res.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) };
  }
}

let webhookReady = false;

/** Point the bot at Loki once per process; cheap to call before every link. */
export async function ensureWebhook(): Promise<boolean> {
  if (webhookReady) return true;
  const url = `${APP_URL}/api/telegram/webhook`;
  const info = await callBot<{ url?: string }>("getWebhookInfo", {});
  if (info.ok && info.result?.url === url) return (webhookReady = true);
  const set = await callBot("setWebhook", {
    url,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "my_chat_member"],
    drop_pending_updates: true,
  });
  webhookReady = set.ok;
  return set.ok;
}
