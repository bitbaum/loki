import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePrivateApiAccessWithBearer } from "@/lib/private-zone-api";
import { readJsonBody } from "@/lib/api/route-helpers";
import {
  claimApprovedActionsByType,
  releaseActionClaim,
  getActionById,
  markActionExecuted,
} from "@/db/queries/actions";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { ACTION_TYPE } from "@/lib/constants/statuses";
import { notifyActionExecuted } from "@/lib/actions/notify-decision";
import { standingApprovalVerdict } from "@/lib/actions/standing-approval";
import { getUserPreferences } from "@/db/queries/user-preferences";

/**
 * Calendar-event drain seam for the LOCAL runtime.
 *
 * Calendar writes run through the locally-authenticated `gog` CLI, which only
 * exists on the operator's machine. When an event is approved on the cloud
 * control plane, executeAction leaves it 'approved' (see execute-action.ts).
 * The local drain (home/calendar-drain.ts) polls GET here for those rows, books
 * each via gog, then POSTs the result back so the row advances to 'executed'.
 *
 * The `actions` table stays the single source of truth — we do NOT copy the
 * intent into pending_commands. Bearer (ck_*) or session auth, per-user scoped.
 *
 * GET CLAIMS, it does not merely read. A booking is only marked executed after
 * gog succeeds, so between handing a row out and hearing back it still looks
 * approved-and-unbooked — and a second drain polling that window would book the
 * same event again, putting a duplicate in the operator's real calendar. The
 * claim (+ lease, for a drain that dies mid-booking) is what makes this seam
 * safe for more than one runtime, which is what home/calendar-drain.ts's own
 * usage line invites.
 */

/**
 * How long a drain owns a row it has taken. Generous next to a `gog calendar
 * create` (which runs under a 20s timeout), because the cost of the two
 * directions is not symmetric: too short and a slow booking gets handed to a
 * second drain and lands in the calendar twice; too long and a drain that died
 * mid-booking strands the event for that many minutes. Duplicates are worse —
 * a delayed booking is still correct, a doubled one is not.
 */
const CLAIM_LEASE_MINUTES = 5;

/**
 * Rows handed out per poll. The drain books them one at a time under a 20s gog
 * timeout, so 10 is ~200s of work — comfortably inside the 5-minute lease. A
 * bigger batch could go stale in the drain's own hands and be re-claimed by
 * another drain while it is still working through it, which is the exact
 * duplicate this endpoint exists to prevent. A backlog just drains over
 * several polls (15s apart), which is fine.
 */
const CLAIM_BATCH_LIMIT = 10;

// GET — CLAIM approved-but-unbooked calendar events for this runtime.
//
// Not a read. Handing the same row to two drains books the same event twice in
// the operator's real calendar (see claimApprovedActionsByType). The claim is
// what makes this endpoint safe to poll from more than one place.
export async function GET() {
  const access = await requirePrivateApiAccessWithBearer();
  if (access instanceof NextResponse) return access;
  const { userId } = access;

  const events = await claimApprovedActionsByType(
    userId,
    ACTION_TYPE.CREATE_EVENT,
    CLAIM_LEASE_MINUTES,
    CLAIM_BATCH_LIMIT,
  );
  return NextResponse.json({ events });
}

const DrainResultBody = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  eventId: z.string().optional(),
  htmlLink: z.string().optional(),
  error: z.string().max(1000).optional(),
});

// POST — the local runtime reports the outcome of booking one event.
export async function POST(req: NextRequest) {
  const access = await requirePrivateApiAccessWithBearer();
  if (access instanceof NextResponse) return access;
  const { userId } = access;

  const dataOrResp = await readJsonBody(req, DrainResultBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { id, ok, eventId, htmlLink, error } = dataOrResp;

  if (!ok) {
    // Booking failed on the local side — leave the row 'approved' for a retry on
    // the next drain pass, but record why so a permanently-bad event is visible.
    // Release the claim too: the lease would expire on its own, but a transient
    // gog error should cost one poll interval, not the full lease.
    const row = await getActionById(userId, id);
    if (row)
      await recordActionAuditEvent(userId, row, "failed", {
        reason: error ?? "gog booking failed",
      });
    await releaseActionClaim(id, userId);
    return NextResponse.json({ ok: false, marked: false });
  }

  // Guarded approved → executed; a second report for the same row is a no-op.
  const executed = await markActionExecuted(id, userId);
  if (!executed) return NextResponse.json({ ok: true, marked: false });
  await recordActionAuditEvent(userId, executed, "executed", {
    meta: { eventId: eventId ?? null, htmlLink: htmlLink ?? null, via: "local-drain" },
  });

  // Tell the operator the event is really in their calendar.
  //
  // This is the ONLY confirmation for the ordinary path: approval happens on
  // the cloud control plane, which has no `gog`, so the row is deferred here
  // and the booking finishes minutes later in a different process. Without
  // this, "I booked it" was said by whoever approved — before anything had
  // been booked — and the operator found out it had failed by noticing an
  // appointment that was not there.
  //
  // Whether a standing rule approved it is RE-DERIVED rather than carried:
  // a rule that covers this action means no human ever saw the row, because
  // enqueueAction approves rule-covered drafts before they can be shown. The
  // only way that reads wrong is if the rule was switched on inside the few
  // seconds between proposal and booking, which costs a sentence, not a fact.
  const standing = await getUserPreferences(userId)
    .then((p) => p.standingApprovals)
    .catch(() => [] as string[]);
  const autoApproved = standingApprovalVerdict({
    type: executed.type,
    payload: executed.payload,
    standingApprovals: standing,
  }).auto;
  await notifyActionExecuted(userId, executed, { htmlLink: htmlLink ?? null, autoApproved }).catch(
    () => {},
  );

  return NextResponse.json({ ok: true, marked: true });
}
