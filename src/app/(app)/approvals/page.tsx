import Link from "next/link";
import { Lock, Inbox } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { Card } from "@/components/ui/card";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { getPendingActions } from "@/db/queries/actions";
import { ActionQueueCard } from "@/components/today/ActionQueueCard";
import { StandingApprovals } from "@/components/today/StandingApprovals";
import { getUserPreferences } from "@/db/queries/user-preferences";
import {
  STANDING_APPROVAL_OPTIONS,
  sanitizeStandingApprovals,
} from "@/lib/actions/standing-approval";

export const metadata = { title: "Approvals" };

/**
 * The Approval Queue as a first-class destination.
 *
 * Loki (and every other producer) tells the user "approve it in your Loki
 * Approval Queue" — this page is that place, linkable and in the nav, instead
 * of a card buried mid-way down /today that vanishes when the zone is locked.
 * The queue UI itself stays SSOT in ActionQueueCard.
 */
export default async function ApprovalsPage() {
  const userId = await requirePageUserId();

  // Locked zone: action contents may reference private entities, so the queue
  // stays hidden — but the page must not dead-end. Show that work is waiting
  // (a bare count leaks no content) and route through the unlock flow.
  if (await isPrivateZoneLocked(userId)) {
    const pendingCount = (await getPendingActions(userId)).length;
    return (
      <PageLayout title="Approvals" subtitle="Review & approve actions Loki proposed">
        <Card>
          <div className="flex items-start gap-3">
            <Lock className="h-4 w-4 text-text-tertiary shrink-0 mt-1" />
            <div className="flex-1 min-w-0">
              <div className="text-sm md:text-base font-medium">
                {pendingCount === 0
                  ? "The queue is behind your private-zone PIN."
                  : `${pendingCount} proposed action${pendingCount === 1 ? "" : "s"} waiting for your review.`}
              </div>
              <p className="text-xs md:text-sm text-text-secondary mt-1">
                Proposals can reference people and other private data, so they stay hidden until you
                unlock.
              </p>
              <Link href="/unlock?next=/approvals" className="ui-btn-primary mt-3 inline-flex">
                Unlock to review
              </Link>
            </div>
          </div>
        </Card>
      </PageLayout>
    );
  }

  const prefs = await getUserPreferences(userId).catch(() => null);

  return (
    <PageLayout title="Approvals" subtitle="Review & approve actions Loki proposed">
      <StandingApprovals
        options={STANDING_APPROVAL_OPTIONS.map((o) => ({ ...o }))}
        initial={sanitizeStandingApprovals(prefs?.standingApprovals)}
      />
      <ActionQueueCard
        autoOpenTop
        emptyState={
          <div className="ui-empty-page">
            <Inbox className="h-5 w-5 text-text-tertiary" />
            <p className="text-sm text-text-secondary">
              Nothing waiting for approval. When Loki proposes an email, message, event, or
              commitment, it lands here for your yes/no.
            </p>
          </div>
        }
      />
    </PageLayout>
  );
}
