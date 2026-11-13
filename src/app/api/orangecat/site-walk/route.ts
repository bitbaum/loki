/**
 * POST /api/orangecat/site-walk — a person's OrangeCat bot walks a live site
 * in Loki's browser and gets back, per page, what is wrong with it.
 *
 * The QA half of Cat Bot (OrangeCat docs/PARITY.md, plan step 1). The same
 * signed rail and the same account rule as /api/orangecat/feedback: the
 * caller is the Loki account linked to the OrangeCat actor in the body, and
 * an actor with no linked account walks nothing. The walk itself is
 * lib/site-walk: a few pages at phone size, facts only, private network
 * refused.
 *
 * Read-only: it opens public pages and files nothing. A bot files what it
 * found through the feedback door.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { isFreshIssuedAt } from "@/lib/integrations/orangecat-actor-status";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { parseWalk, runWalk } from "@/lib/site-walk";

export const dynamic = "force-dynamic";
/** Three pages, forty seconds each at the outside. */
export const maxDuration = 150;

const Body = z
  .object({
    actorId: z.string().uuid(),
    issuedAt: z.string().datetime(),
    steps: z.array(z.unknown()).max(20),
    /** Leave the pictures out: words only. */
    screenshots: z.boolean().optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "site walk not configured");
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
    const walk = parseWalk(data.steps);
    if (!walk.ok) {
      return NextResponse.json({ error: "bad walk", detail: walk.error }, { status: 400 });
    }
    const result = await runWalk(walk.steps);
    const steps =
      data.screenshots === false
        ? result.steps.map(({ screenshot: _omit, ...rest }) => rest)
        : result.steps;
    return NextResponse.json(
      { ok: true, passed: result.ok, viewport: result.viewport, steps },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[orangecat/site-walk] failed:", (err as Error).message);
    return NextResponse.json({ error: "site walk failed" }, { status: 500 });
  }
}
