/**
 * The adapter every Loki sender uses: the message it already composes (text
 * and its button rows) handed to the gateway AS A PERSON'S notice, so that
 * person's Settings choices, their own Telegram link, the caps and the quiet
 * nights apply to all of Loki — not only to the senders written after them.
 *
 * Buttons composed here are Loki's own links (signed approval links, a
 * customer's own site, a deploy run), so they are marked trusted; the host
 * allowlist guards links that arrive from outside (lib/notify/policy.ts).
 */
import type { NotifyCategory } from "@/config/notify-categories";
import type { SendResult, TelegramKeyboard } from "@/lib/actions/telegram-send";
import { deliverNotice } from "@/lib/notify/deliver";

export async function notifyPerson(
  userId: string,
  m: {
    /** Who speaks, for the caps (per sender) and the list row. */
    source: string;
    category: NotifyCategory;
    text: string;
    buttons: TelegramKeyboard;
    /** "now" only for what cannot wait an hour; nights are silent anyway. */
    urgency?: "now" | "today";
    /** Same key = same incident (dedupe, backed-off reminders). */
    key?: string;
  },
): Promise<SendResult> {
  const [title, ...rest] = m.text.trim().split("\n");
  const result = await deliverNotice(userId, {
    source: m.source,
    category: m.category,
    title: title ?? "",
    body: rest.join("\n").trim() || undefined,
    actions: m.buttons.flat().map((b) => ({ label: b.text, url: b.url, trusted: true })),
    urgency: m.urgency ?? "today",
    key: m.key,
    // These senders keep their own row on /today, /approvals or /feedback.
    listed: false,
  });
  return result.sent ? { ok: true } : { ok: false, error: result.why ?? "not sent" };
}
