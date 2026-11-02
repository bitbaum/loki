/**
 * POST /api/telegram/webhook — Loki's notification bot (lib/telegram/notify-bot.ts).
 *
 * Telegram calls this for the bot's messages. It does three things only:
 *  - "/start <code>" from the "Connect Telegram" link: link this chat to the
 *    person who asked for the code, and say so with a button to their choices;
 *  - "/stop", or the person blocking the bot: forget the chat;
 *  - anything else: one line saying where Loki lives.
 * Refuses any call without Telegram's secret-token header. Always answers 200
 * to Telegram, so a bad update is not retried forever.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { APP_URL } from "@/config/brand";
import { linkChatByCode, unlinkChat } from "@/db/queries/telegram-links";
import { logDebug } from "@/db/queries/debug-logs";
import { callBot, webhookSecret } from "@/lib/telegram/notify-bot";

type Update = {
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { username?: string };
  };
  my_chat_member?: {
    chat?: { id?: number };
    new_chat_member?: { status?: string };
  };
};

const SETTINGS_URL = `${APP_URL}/settings#notifications`;

function authentic(req: NextRequest): boolean {
  const got = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const want = Buffer.from(webhookSecret());
  return got.length === want.length && timingSafeEqual(got, want);
}

async function reply(chatId: number, text: string, button?: { text: string; url: string }) {
  await callBot("sendMessage", {
    chat_id: chatId,
    text,
    ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
    link_preview_options: { is_disabled: true },
  });
}

export async function POST(req: NextRequest) {
  if (!authentic(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const update = (await req.json().catch(() => ({}))) as Update;
  try {
    const left = update.my_chat_member;
    if (left?.chat?.id && ["kicked", "left"].includes(left.new_chat_member?.status ?? "")) {
      await unlinkChat(String(left.chat.id));
      return NextResponse.json({ ok: true });
    }
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (!chatId || msg?.chat?.type !== "private") return NextResponse.json({ ok: true });
    const text = (msg.text ?? "").trim();

    const start = /^\/start(?:\s+([A-Za-z0-9_-]{8,64}))?$/.exec(text);
    if (start?.[1]) {
      const userId = await linkChatByCode(start[1], String(chatId), msg.from?.username ?? null);
      if (userId) {
        await reply(
          chatId,
          "Connected. Loki will send you here only what needs one tap from you — and nothing at night.",
          { text: "Choose what you get", url: SETTINGS_URL },
        );
      } else {
        await reply(chatId, "That link has expired. Open Loki and tap Connect Telegram again.", {
          text: "Open Settings",
          url: SETTINGS_URL,
        });
      }
      return NextResponse.json({ ok: true });
    }
    if (text === "/stop") {
      await unlinkChat(String(chatId));
      await reply(chatId, "Disconnected. Loki will not message you here.");
      return NextResponse.json({ ok: true });
    }
    await reply(
      chatId,
      "This chat only delivers Loki's notices. To connect, open Loki → Settings → Notifications.",
      { text: "Open Settings", url: SETTINGS_URL },
    );
  } catch (err) {
    void logDebug({
      source: "telegram/webhook",
      level: "error",
      message: `update not handled: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return NextResponse.json({ ok: true });
}
