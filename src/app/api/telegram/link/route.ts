/**
 * Settings → Notifications → Telegram.
 *  GET    — is this person connected, and what do they get there
 *  POST   — a one-time "Connect Telegram" link (t.me/<bot>?start=<code>)
 *  PATCH  — turn one kind of message on or off
 *  DELETE — disconnect
 */
import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { isSiteOperator } from "@/db/queries/users";
import {
  createLinkCode,
  getTelegramLink,
  setTelegramChoice,
  unlinkTelegram,
} from "@/db/queries/telegram-links";
import {
  categoriesFor,
  isCategoryOn,
  NOTIFY_CATEGORIES,
  NOTIFY_CATEGORY_IDS,
} from "@/config/notify-categories";
import {
  ensureWebhook,
  notifyBotConfigured,
  notifyBotUsername,
  startLink,
} from "@/lib/telegram/notify-bot";
import { selfTelegramTarget } from "@/lib/actions/telegram-send";

async function view(userId: string) {
  const operator = await isSiteOperator(userId).catch(() => false);
  const link = await getTelegramLink(userId);
  return {
    available: notifyBotConfigured(),
    bot: notifyBotUsername(),
    linked: link.linked,
    username: link.username,
    linkedAt: link.linkedAt,
    // The operator's chat from before per-person links: it keeps working.
    legacyChat: operator && !link.linked && Boolean(selfTelegramTarget()),
    categories: categoriesFor(operator).map((id) => ({
      id,
      label: NOTIFY_CATEGORIES[id].label,
      note: NOTIFY_CATEGORIES[id].note,
      on: isCategoryOn(link.choices, id),
    })),
  };
}

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await view(userId));
}

export async function POST() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!notifyBotConfigured()) {
    return NextResponse.json(
      { error: "Telegram is not set up on this Loki yet." },
      { status: 503 },
    );
  }
  if (!(await ensureWebhook())) {
    return NextResponse.json(
      { error: "Telegram did not accept Loki's bot. Try again in a minute." },
      { status: 502 },
    );
  }
  const url = startLink(await createLinkCode(userId));
  return NextResponse.json({ url });
}

const Patch = z.object({ category: z.enum(NOTIFY_CATEGORY_IDS), on: z.boolean() });

export async function PATCH(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(req, Patch);
  if (body instanceof NextResponse) return body;
  await setTelegramChoice(userId, body.category, body.on);
  return NextResponse.json(await view(userId));
}

export async function DELETE() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await unlinkTelegram(userId);
  return NextResponse.json(await view(userId));
}
