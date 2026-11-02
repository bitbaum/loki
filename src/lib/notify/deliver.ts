/**
 * The one way any bot of the fleet reaches the owner: Loki's own jobs, the
 * box's alerting, OrangeCat's Cat. See lib/notify/policy.ts for the contract
 * and docs/telegram-notifications.md for who calls it.
 *
 * Every notice is RECORDED (an `alerts` row, so it is on /today or /system),
 * and only a notice the policy admits is SENT. A notice with no button never
 * reaches the phone: it is the list's, not the chat's.
 */
import { APP_URL } from "@/config/brand";
import {
  closeNotice,
  countDeliveries,
  findOpenNotice,
  insertNotice,
  updateNotice,
  type NoticeMeta,
} from "@/db/queries/notices";
import { getUserById } from "@/db/queries/users";
import { logDebug } from "@/db/queries/debug-logs";
import { sendTelegramMessage, sendTelegramVoice } from "@/lib/actions/telegram-send";
import { telegramTargetFor } from "@/lib/actions/telegram-for-user";
import {
  decideDelivery,
  formatNotice,
  validateNotice,
  type NoticeRequest,
} from "@/lib/notify/policy";
import { voiceNoteFor, voicePitch } from "@/lib/notify/voice";

/** Recorded with a button → the operator's list. Without → /system's. */
export const NOTICE_TYPE = "notice";
export const SYSTEM_EVENT_TYPE = "system_event";

export type DeliverResult = {
  /** The list row this notice lives in. */
  alertId: string | null;
  /** True when a Telegram message went out. */
  sent: boolean;
  rang: boolean;
  /** Why it did not go to the phone, when it did not. */
  why?: string;
};

/**
 * Record a notice and, when the policy allows, send it. Never throws: a bot
 * that cannot reach the owner must not fail its own work over it.
 */
export async function deliverNotice(
  userId: string,
  input: NoticeRequest,
  now = Date.now(),
): Promise<DeliverResult> {
  try {
    return await deliver(userId, input, now);
  } catch (err) {
    void logDebug({
      source: "notify",
      level: "error",
      message: `notice from ${input.source} not recorded: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { alertId: null, sent: false, rang: false, why: "error" };
  }
}

async function deliver(userId: string, input: NoticeRequest, now: number): Promise<DeliverResult> {
  const valid = validateNotice(input);
  const actionable = valid.ok;
  const type = actionable ? NOTICE_TYPE : SYSTEM_EVENT_TYPE;
  const notice = valid.ok ? valid.notice : input;
  const key = notice.key?.trim() || `${notice.source}:${notice.title}`;

  // One row per incident: a repeat raises the count on the open row instead of a new line.
  const open = await findOpenNotice(userId, type, key);
  const prev = (open?.metadata ?? {}) as NoticeMeta;
  const meta: NoticeMeta = {
    ...prev,
    source: notice.source,
    key,
    urgency: notice.urgency,
    actions: notice.actions,
    seen: (prev.seen ?? 0) + 1,
  };
  const row = {
    title: notice.title.slice(0, 200),
    description: notice.body ?? null,
    severity: notice.urgency === "now" ? "urgent" : "info",
    actionUrl: notice.actions?.[0]?.url ?? null,
  };
  const alertId = open
    ? (await updateNotice(open.id, { ...row, metadata: meta }), open.id)
    : ((await insertNotice({ userId, type, ...row, metadata: meta }))?.id ?? null);

  if (!valid.ok) {
    if (alertId) await updateNotice(alertId, { metadata: { ...meta, heldBecause: valid.reason } });
    return { alertId, sent: false, rang: false, why: valid.reason };
  }

  const chat = await telegramTargetFor(userId);
  if (!chat) return { alertId, sent: false, rang: false, why: "this account has no Telegram chat" };

  const hourAgo = new Date(now - 3600_000);
  const dayAgo = new Date(now - 24 * 3600_000);
  const decision = decideDelivery(
    valid.notice,
    {
      lastForKey: prev.deliveredAt ? { at: prev.deliveredAt, count: prev.delivered ?? 1 } : null,
      sourceLastHour: await countDeliveries(userId, hourAgo, notice.source),
      lastDay: await countDeliveries(userId, dayAgo),
    },
    now,
  );
  if (!decision.deliver) {
    if (alertId)
      await updateNotice(alertId, { metadata: { ...meta, heldBecause: decision.reason } });
    return { alertId, sent: false, rang: false, why: decision.reason };
  }

  const text = formatNotice(valid.notice);
  const buttons = [valid.notice.actions.map((a) => ({ text: a.label, url: a.url }))];
  let sent = false;
  if (valid.notice.voice) {
    const user = await getUserById(userId);
    const voice = await voiceNoteFor(text, user?.plan ?? "free");
    if (voice.audio) {
      const r = await sendTelegramVoice(chat, voice.audio, {
        caption: text,
        buttons,
        silent: !decision.ring,
      });
      sent = r.ok;
    } else if (voice.pitch) {
      // Not entitled: the text still goes out, and once a month the owner of
      // the account is shown — like any customer — what voice notes cost.
      await deliverNotice(userId, voicePitch(APP_URL), now);
    }
  }
  if (!sent) {
    const r = await sendTelegramMessage(chat, text, { buttons, silent: !decision.ring });
    sent = r.ok;
    if (!r.ok) {
      void logDebug({
        source: "notify",
        level: "warn",
        message: `telegram refused a notice: ${r.error}`,
      });
    }
  }
  if (sent && alertId) {
    await updateNotice(alertId, {
      metadata: {
        ...meta,
        delivered: (prev.delivered ?? 0) + 1,
        deliveredAt: now,
        heldBecause: undefined,
      },
    });
  }
  return { alertId, sent, rang: sent && decision.ring };
}

/** The incident is over: close its row so the next occurrence is news again. Says nothing. */
export async function resolveNotice(userId: string, key: string): Promise<void> {
  await closeNotice(userId, NOTICE_TYPE, key).catch(() => 0);
  await closeNotice(userId, SYSTEM_EVENT_TYPE, key).catch(() => 0);
}
