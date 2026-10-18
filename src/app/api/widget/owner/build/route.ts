import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS } from "@/lib/constants/time";
import { listProjectFeedback } from "@/db/queries/site-feedback";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { startOwnerBatchBuild, startOwnerBuild } from "@/lib/feedback/owner-build";
import { OWNER_CHANGES_FETCH } from "@/lib/feedback/owner-view";
import { groupNotesByPage, savedNotesToBuild } from "@/lib/feedback/saved-notes";
import { ownerRequest } from "@/lib/widget/owner-request";

/**
 * "Build them": start the owner's saved notes from their own site.
 *
 * The owner records notes while Loki watches and saves them (held out of
 * automatic work); the panel's status line counts them and offers this one
 * tap. Same guard as Your changes (lib/widget/owner-request.ts) — without a
 * valid pass it starts nothing. The notes start as one build per page,
 * through the owner's own path (startOwnerBuild for a lone note,
 * startOwnerBatchBuild for several) and its daily limit.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

/** A tap, not a poll. */
const RATE_PER_IP = 10;

const Body = z.object({
  token: z.string().startsWith("fcw_").max(100),
  ownerPass: z.string().min(1).max(400),
});

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`widget-build-notes:ip:${ip}`, RATE_PER_IP, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsJson({ error: "Too many requests" }, 429);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return corsJson({ error: "Invalid request" }, 400);

  const who = await ownerRequest(req, parsed.data);
  if (who.kind === "error") return corsJson({ error: who.error }, who.status);
  if (who.kind === "stranger") return corsJson({ ok: true, owner: false, started: 0 });
  const { token } = who;

  const all = await listProjectFeedback(token.userId, token.projectId, OWNER_CHANGES_FETCH);
  const notes = savedNotesToBuild(
    await attachFeedbackWork(
      token.userId,
      all.filter((i) => i.requiresReview),
    ),
  );
  let started = 0;
  let builds = 0;
  let note: string | undefined;
  // One build per page, in the order things were said: a page's notes are
  // fixed together, in one pass that sees them all.
  for (const group of groupNotesByPage(notes)) {
    const r =
      group.length === 1
        ? await startOwnerBuild(token.userId, token.projectId, group[0].id)
        : await startOwnerBatchBuild(token.userId, token.projectId, group);
    if (r.building) {
      started += group.length;
      builds++;
    } else note ??= r.buildNote;
  }
  return corsJson({
    ok: true,
    owner: true,
    started,
    builds,
    total: notes.length,
    ...(note ? { note } : {}),
  });
}
