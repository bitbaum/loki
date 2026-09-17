import { CalendarCheck, CircleCheck, CircleSlash, Link2Off } from "lucide-react";
import Link from "next/link";
import { PageLayout } from "@/components/ui/page-layout";
import { verifyActionLinkToken } from "@/lib/actions/action-link";
import { approveAction, getActionById, rejectAction } from "@/db/queries/actions";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { finalizeApproved } from "@/lib/actions/finalize-approved";
import { ACTION_STATUS, ACTION_TYPE } from "@/lib/constants/statuses";

export const metadata = { title: "Decision" };
// The whole point is that it acts. Nothing here may be cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * The other end of a Telegram approval button.
 *
 * The token carries the authorisation (see lib/actions/action-link.ts), so this
 * page works on a phone that has never signed into Loki — which is the only
 * reason a one-tap approval is one tap. It decides ONE action with ONE verb and
 * shows what happened.
 *
 * Every dead end is a real answer, not an error: a link tapped twice, a draft
 * someone already decided in the app, a link that outlived its draft. All three
 * are states the operator can and will reach, and "that didn't work" would send
 * them to the app to find out which — the trip this page exists to remove.
 *
 * ON THE PRIVATE-ZONE LOCK, which /approvals honours and this page does not.
 * That page hides the queue behind the PIN because proposals can name private
 * people, and it is reachable by anyone holding a session. This page is
 * reachable only by holding a link that was sent to one chat and names one
 * action — and the message that carried it already stated the title in full.
 * Re-showing that title discloses nothing the holder of the link was not just
 * shown. It deliberately shows NOTHING ELSE: no queue, no other rows, no
 * navigation into the app's data. If this page ever grows a list, it needs the
 * lock.
 */
export default async function ActionLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claim = verifyActionLinkToken(token);

  if (!claim) {
    return (
      <Outcome
        icon={<Link2Off className="h-5 w-5 text-text-tertiary" />}
        title="This link is no longer valid"
        body="Approval links expire, and each one works for a single decision. Open the queue to decide it there."
      />
    );
  }

  const action = await getActionById(claim.userId, claim.actionId);
  if (!action) {
    return (
      <Outcome
        icon={<Link2Off className="h-5 w-5 text-text-tertiary" />}
        title="That item is gone"
        body="It was expired or removed from the queue. Nothing was changed."
      />
    );
  }

  // Already decided — including by an earlier tap on this same link. Report the
  // state plainly rather than treating a second tap as a failure: the operator
  // pressed a button and is owed the answer to "what is it now", not a 404.
  if (action.status !== ACTION_STATUS.DRAFT) {
    return (
      <Outcome
        icon={<CircleCheck className="h-5 w-5 text-text-tertiary" />}
        title={`Already ${action.status}`}
        body={`“${action.title}” was ${action.status} already — this link changed nothing.`}
      />
    );
  }

  if (claim.verb === "reject") {
    const [rejected] = await rejectAction(claim.actionId, claim.userId);
    if (!rejected) return <RaceLost title={action.title} />;
    await recordActionAuditEvent(claim.userId, rejected, "rejected", {
      meta: { via: "one-tap-link" },
    });
    return (
      <Outcome
        icon={<CircleSlash className="h-5 w-5 text-text-tertiary" />}
        title="Rejected"
        body={`“${action.title}” will not happen. Nothing was sent or booked.`}
      />
    );
  }

  const [approved] = await approveAction(claim.actionId, claim.userId);
  if (!approved) return <RaceLost title={action.title} />;
  const execution = await finalizeApproved(claim.userId, approved, { via: "operator" });

  // A calendar event approved in the cloud is handed to the box drain, so it is
  // not booked yet and must not be reported as if it were. Saying "booked" here
  // is precisely the over-claim the executor's fail-closed contract exists to
  // prevent — and the operator would discover the lie by looking at an empty
  // calendar. The real confirmation arrives on Telegram when gog succeeds.
  const pendingBooking = action.type === ACTION_TYPE.CREATE_EVENT && !execution.executed;

  return (
    <Outcome
      icon={<CalendarCheck className="h-5 w-5 text-brand" />}
      title="Approved"
      body={
        pendingBooking
          ? `“${action.title}” is approved. It goes into your calendar within a minute — you'll get a message here when it's really there.`
          : execution.executed
            ? `“${action.title}” is done.`
            : `“${action.title}” is approved and queued to run.`
      }
    />
  );
}

/** Lost the row between reading it and deciding it — decided elsewhere, or expired. */
function RaceLost({ title }: { title: string }) {
  return (
    <Outcome
      icon={<CircleCheck className="h-5 w-5 text-text-tertiary" />}
      title="Someone got there first"
      body={`“${title}” was already decided somewhere else. Nothing was changed here.`}
    />
  );
}

function Outcome({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <PageLayout title="" maxWidth="max-w-md">
      <div className="ui-card space-y-3 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0 space-y-1">
            <h1 className="text-base font-medium">{title}</h1>
            <p className="text-sm text-text-secondary">{body}</p>
          </div>
        </div>
        <Link href="/approvals" className="ui-btn-secondary inline-flex">
          Open the queue
        </Link>
      </div>
    </PageLayout>
  );
}
