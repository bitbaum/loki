/**
 * Send to ONE person's own linked chat, through Loki's notification bot.
 * The chat id is looked up here from the person's link, never passed in, so no
 * caller can aim a message at a chat the person did not connect themselves.
 */
import { getTelegramTarget } from "@/db/queries/telegram-links";
import {
  normalizeKeyboard,
  NOT_ACTIONABLE,
  type TelegramKeyboard,
  type SendResult,
} from "@/lib/actions/telegram-send";
import { callBot, notifyBotConfigured, notifyBotToken } from "@/lib/telegram/notify-bot";

export async function sendToLinkedChat(
  userId: string,
  text: string,
  options: { buttons: TelegramKeyboard; silent: boolean },
): Promise<SendResult> {
  if (!notifyBotConfigured()) return { ok: false, error: "notify bot not configured" };
  const keyboard = normalizeKeyboard(options.buttons);
  if (!keyboard) return { ok: false, error: NOT_ACTIONABLE };
  const { chatId } = await getTelegramTarget(userId);
  if (!chatId) return { ok: false, error: "no linked Telegram chat" };
  const r = await callBot<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: keyboard },
    link_preview_options: { is_disabled: true },
    ...(options.silent ? { disable_notification: true } : {}),
  });
  return r.ok
    ? {
        ok: true,
        messageId: r.result?.message_id != null ? String(r.result.message_id) : undefined,
      }
    : { ok: false, error: r.description ?? "telegram refused" };
}

/** The same, as a voice note (OGG/Opus) with the text as caption. */
export async function sendVoiceToLinkedChat(
  userId: string,
  ogg: Buffer,
  options: { caption: string; buttons: TelegramKeyboard; silent: boolean },
): Promise<SendResult> {
  const token = notifyBotToken();
  if (!token || !notifyBotConfigured()) return { ok: false, error: "notify bot not configured" };
  const keyboard = normalizeKeyboard(options.buttons);
  if (!keyboard) return { ok: false, error: NOT_ACTIONABLE };
  const { chatId } = await getTelegramTarget(userId);
  if (!chatId) return { ok: false, error: "no linked Telegram chat" };
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", options.caption.slice(0, 1024));
  form.set("voice", new Blob([new Uint8Array(ogg)], { type: "audio/ogg" }), "notice.ogg");
  form.set("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  if (options.silent) form.set("disable_notification", "true");
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return data.ok
      ? { ok: true }
      : { ok: false, error: data.description ?? `telegram ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
