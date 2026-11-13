/**
 * POST /api/orangecat/browser — one step in a bot's own browser.
 *
 * Cat Bot's computer use (OrangeCat docs/PARITY.md, plan step 2). The same
 * signed rail and linked-account rule as the other OrangeCat doors: the
 * browser belongs to the Loki account linked to the actor, one per bot
 * (`botId`), and no other account can reach it. The driving is
 * lib/bot-browser; the bounds (no password, no card) are
 * lib/bot-browser-rules.
 *
 * Every answer carries what the page now shows: its address and title, what
 * can be read, what can be clicked or typed into (numbered), and a picture
 * at a web address a chat thread can show.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { APP_URL } from "@/config/brand";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { botBrowserStep, type BotBrowserView } from "@/lib/bot-browser";
import { BotBrowserAction } from "@/lib/bot-browser-rules";
import { saveShot, shotUrl } from "@/lib/bot-shots";
import { isFreshIssuedAt } from "@/lib/integrations/orangecat-actor-status";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z
  .object({
    actorId: z.string().uuid(),
    issuedAt: z.string().datetime(),
    /** Whose browser: the bot's id on OrangeCat. One browser per bot. */
    botId: z.string().uuid(),
    action: BotBrowserAction,
    /** Leave the picture out: words only. */
    screenshot: z.boolean().optional(),
  })
  .strict();

async function withPictureUrl(view: BotBrowserView | undefined, origin: string) {
  if (!view) return undefined;
  const { screenshot, ...rest } = view;
  const token = screenshot ? await saveShot(screenshot) : null;
  return { ...rest, ...(token ? { screenshotUrl: shotUrl(origin, token) } : {}) };
}

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "bot browser not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const data = dataOrResp;

  // Signed, but with no nonce: without this a captured request replays forever.
  if (!isFreshIssuedAt(data.issuedAt)) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  try {
    const user = await getUserByOrangeCatActorId(data.actorId);
    if (!user) {
      return NextResponse.json(
        {
          error: "no linked Loki account",
          detail:
            "This OrangeCat identity is not linked to a Loki account yet. Sign in to Loki with the same OrangeCat identity once, then try again.",
        },
        { status: 409 },
      );
    }
    const result = await botBrowserStep(user.id, data.botId, data.action, {
      screenshot: data.screenshot !== false,
    });
    const view = await withPictureUrl("view" in result ? result.view : undefined, APP_URL);
    const body = result.ok
      ? { ok: true, done: true, closed: result.closed === true, ...(view ? { view } : {}) }
      : {
          ok: true,
          done: false,
          reason: result.reason,
          detail: result.detail,
          ...(view ? { view } : {}),
        };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[orangecat/browser] failed:", (err as Error).message);
    return NextResponse.json({ error: "bot browser failed" }, { status: 500 });
  }
}
