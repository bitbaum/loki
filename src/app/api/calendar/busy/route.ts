import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePrivateApiAccessWithBearer } from "@/lib/private-zone-api";
import { readJsonBody } from "@/lib/api/route-helpers";
import { replaceBusyWindow, pruneBusyBefore } from "@/db/queries/calendar-busy";
import { DAY_MS } from "@/lib/constants/time";

/**
 * The box pushes a window of the operator's calendar here.
 *
 * The cloud cannot read the calendar — `gog` is authenticated on the operator's
 * machine only — so an approval card asking "shall I book Thursday 14:30?" had
 * no way to notice Thursday 14:30 was already taken. This is the one-way feed
 * that lets it notice. Written by home/calendar-drain.ts, which already holds
 * both halves it needs: `gog` and the ck_* token.
 *
 * WHAT THIS IS NOT: a sync. Nothing here ever writes back to Google, and no
 * consumer treats these rows as truth. It is a cache for one question — "is
 * that slot taken, and by what" — and it is deliberately incapable of carrying
 * attendees, descriptions or locations off the operator's machine.
 */

const BusyBlockBody = z.object({
  eventId: z.string().trim().min(1).max(512),
  summary: z.string().trim().max(300).nullable().optional(),
  startsAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid start"),
  endsAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid end"),
  allDay: z.boolean().default(false),
});

const SyncBody = z.object({
  /** The span the sender actually looked at — the rows it is entitled to replace. */
  windowStart: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid windowStart"),
  windowEnd: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid windowEnd"),
  /**
   * Empty is a real, meaningful value: "I looked at that window and it is free."
   * It must clear the mirror for the window rather than be mistaken for a
   * malformed request, or a cleared diary would keep showing yesterday's events.
   */
  events: z.array(BusyBlockBody).max(2000),
});

export async function POST(req: NextRequest) {
  const access = await requirePrivateApiAccessWithBearer();
  if (access instanceof NextResponse) return access;
  const { userId } = access;

  const dataOrResp = await readJsonBody(req, SyncBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const body = dataOrResp;

  const windowStart = new Date(body.windowStart);
  const windowEnd = new Date(body.windowEnd);
  if (windowEnd <= windowStart) {
    return NextResponse.json({ error: "windowEnd must be after windowStart" }, { status: 400 });
  }

  // Drop blocks the sender shouldn't be replacing on this pass. Without this a
  // sender with a wrong clock could delete a window it never looked at and
  // repopulate it with a handful of events, leaving the mirror confidently
  // wrong — which is worse than leaving it merely stale.
  const blocks = body.events
    .map((e) => ({
      eventId: e.eventId,
      summary: e.summary ?? null,
      startsAt: new Date(e.startsAt),
      endsAt: new Date(e.endsAt),
      allDay: e.allDay,
    }))
    .filter((b) => b.endsAt > b.startsAt)
    .filter((b) => b.startsAt >= windowStart && b.startsAt < windowEnd);

  const { removed, written } = await replaceBusyWindow(
    userId,
    windowStart,
    windowEnd,
    blocks,
    new Date(),
  );

  // Housekeeping on the write path rather than a cron of its own: this endpoint
  // is the only thing that grows the table, so it is the natural place to stop
  // it growing forever. One day of slack keeps "did I double-book this morning"
  // answerable.
  const pruned = await pruneBusyBefore(new Date(Date.now() - DAY_MS)).catch(() => 0);

  return NextResponse.json({
    ok: true,
    removed,
    written,
    pruned,
    skipped: body.events.length - blocks.length,
  });
}
