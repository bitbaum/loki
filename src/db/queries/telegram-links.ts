import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema/notification-preferences";
import type { NotifyCategory, NotifyChoices } from "@/config/notify-categories";

/**
 * A person's Telegram link and choices (notification_preferences row).
 * The chat id is only ever written by the bot's webhook, from the chat that
 * pressed Start with this person's one-time code — never typed by anyone.
 */

/** How long a "Connect Telegram" link works. */
export const LINK_CODE_TTL_MS = 30 * 60_000;

async function ensureRow(userId: string) {
  await db.insert(notificationPreferences).values({ userId }).onConflictDoNothing();
}

export type TelegramLinkState = {
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
  choices: NotifyChoices;
};

export async function getTelegramLink(userId: string): Promise<TelegramLinkState> {
  const [row] = await db
    .select({
      chatId: notificationPreferences.telegramChatId,
      username: notificationPreferences.telegramUsername,
      linkedAt: notificationPreferences.telegramLinkedAt,
      choices: notificationPreferences.telegramChoices,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return {
    linked: Boolean(row?.chatId),
    username: row?.username ?? null,
    linkedAt: row?.linkedAt?.toISOString() ?? null,
    choices: row?.choices ?? {},
  };
}

/** The linked chat and the person's choices, for the gateway. */
export async function getTelegramTarget(
  userId: string,
): Promise<{ chatId: string | null; choices: NotifyChoices }> {
  const [row] = await db
    .select({
      chatId: notificationPreferences.telegramChatId,
      choices: notificationPreferences.telegramChoices,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return { chatId: row?.chatId ?? null, choices: row?.choices ?? {} };
}

/** A fresh one-time code for t.me/<bot>?start=<code>. Telegram allows [A-Za-z0-9_-]{1,64}. */
export async function createLinkCode(userId: string, now = Date.now()): Promise<string> {
  await ensureRow(userId);
  const code = randomBytes(18).toString("base64url");
  await db
    .update(notificationPreferences)
    .set({
      telegramLinkCode: code,
      telegramLinkExpiresAt: new Date(now + LINK_CODE_TTL_MS),
      updatedAt: new Date(now),
    })
    .where(eq(notificationPreferences.userId, userId));
  return code;
}

/**
 * Consume a code: link the chat that sent it to the code's owner. Returns the
 * owner's id, or null for an unknown or expired code. A chat linked to
 * someone else before is moved: one chat, one person.
 */
export async function linkChatByCode(
  code: string,
  chatId: string,
  username: string | null,
  now = Date.now(),
): Promise<string | null> {
  const [row] = await db
    .select({ userId: notificationPreferences.userId })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.telegramLinkCode, code),
        gt(notificationPreferences.telegramLinkExpiresAt, new Date(now)),
      ),
    )
    .limit(1);
  if (!row) return null;
  await db
    .update(notificationPreferences)
    .set({ telegramChatId: null, telegramUsername: null, telegramLinkedAt: null })
    .where(eq(notificationPreferences.telegramChatId, chatId));
  await db
    .update(notificationPreferences)
    .set({
      telegramChatId: chatId,
      telegramUsername: username,
      telegramLinkedAt: new Date(now),
      telegramLinkCode: null,
      telegramLinkExpiresAt: null,
      updatedAt: new Date(now),
    })
    .where(eq(notificationPreferences.userId, row.userId));
  return row.userId;
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await db
    .update(notificationPreferences)
    .set({
      telegramChatId: null,
      telegramUsername: null,
      telegramLinkedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(notificationPreferences.userId, userId));
}

/** The chat said /stop or blocked the bot: forget it, whoever it belonged to. */
export async function unlinkChat(chatId: string): Promise<void> {
  await db
    .update(notificationPreferences)
    .set({
      telegramChatId: null,
      telegramUsername: null,
      telegramLinkedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(notificationPreferences.telegramChatId, chatId));
}

export async function setTelegramChoice(
  userId: string,
  category: NotifyCategory,
  on: boolean,
): Promise<NotifyChoices> {
  await ensureRow(userId);
  const current = (await getTelegramLink(userId)).choices;
  const next: NotifyChoices = { ...current, [category]: on };
  await db
    .update(notificationPreferences)
    .set({ telegramChoices: next, updatedAt: new Date() })
    .where(eq(notificationPreferences.userId, userId));
  return next;
}
