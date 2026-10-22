import Link from "next/link";
import { Lock, Inbox } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { EmptyState } from "@/components/ui/empty-state";
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
import { approvalsSentence } from "@/lib/needs-you";
import { loadRecentUpdateDecisions, loadUpdateCards } from "@/lib/packages/load";
import { PackageUpdateQueue } from "@/components/packages/PackageUpdateQueue";
import {
  BuildRequestQueue,
  type BuildRequestCard,
} from "@/components/build-requests/BuildRequestQueue";
import { listBuildRequests } from "@/db/queries/build-requests";
import { isSiteOperator } from "@/db/queries/users";

/** New accounts' build requests — the operator's alone to decide. */
async function loadBuildRequests(userId: string): Promise<BuildRequestCard[]> {
  if (!(await isSiteOperator(userId).catch(() => false))) return [];
  const rows = await listBuildRequests().catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    website: r.website,
    email: r.email,
    words: typeof r.brief.changes === "string" ? r.brief.changes.trim() : "",
    look: r.look,
    status: r.status,
    previewUrl: r.previewUrl,
    accessCode: r.accessCode,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

export const metadata = { title: "Approvals" };

/**
 * The Approval Queue as a first-class destination.
 *
 * Loki (and every other producer) tells the user "approve it in your Loki
 * Approval Queue" — this page is that place, linkable and in the nav, instead
 * of a card buried mid-way down /today that vanishes when the zone is locked.
 * The queue UI itself stays SSOT in ActionQueueCard.
 *
 * Package updates a project's setting held for a person sit here too, read
 * from package_update_requests rather than enqueued as actions: their answer
 * is one of three (take it, not now, stay on this version), the pull request
 * on GitHub is the truth they must follow, and they name projects and package
 * versions — nothing from the private zone — so they show behind the PIN too.
 */
export default async function ApprovalsPage() {
  const userId = await requirePageUserId();
  const [updates, recentUpdates, buildRequests] = await Promise.all([
    loadUpdateCards(userId),
    loadRecentUpdateDecisions(userId),
    loadBuildRequests(userId),
  ]);

  // Locked zone: action contents may reference private entities, so the queue
  // stays hidden — but the page must not dead-end. Show that work is waiting
  // (a bare count leaks no content) and route through the unlock flow.
  // Pending first, then what you set once, then what was decided lately
  // (design reset, 2026-10): no subtitle, no card around the queue, no
  // paragraph over the standing approvals, and an empty queue says so in one
  // quiet line.
  if (await isPrivateZoneLocked(userId)) {
    const pendingCount = (await getPendingActions(userId)).length;
    return (
      <PageLayout title="Approvals" maxWidth="max-w-2xl">
        <EmptyState
          icon={Lock}
          title={
            pendingCount === 0
              ? "Your approvals are behind your PIN"
              : `${approvalsSentence(pendingCount)}, behind your PIN`
          }
          action={
            <Link href="/unlock?next=/approvals" className="ui-btn-secondary">
              Unlock to review
            </Link>
          }
        />
        <BuildRequestQueue requests={buildRequests} />
        <PackageUpdateQueue updates={updates} recent={recentUpdates} />
      </PageLayout>
    );
  }

  const prefs = await getUserPreferences(userId).catch(() => null);
  const otherWaiting = updates.length > 0 || buildRequests.some((r) => r.status === "waiting");

  return (
    <PageLayout title="Approvals" maxWidth="max-w-2xl">
      <ActionQueueCard
        autoOpenTop
        emptyState={
          otherWaiting ? null : <EmptyState icon={Inbox} title="Nothing waiting for you" />
        }
      />
      <BuildRequestQueue requests={buildRequests} />
      <PackageUpdateQueue updates={updates} recent={recentUpdates} />
      <StandingApprovals
        options={STANDING_APPROVAL_OPTIONS.map((o) => ({ ...o }))}
        initial={sanitizeStandingApprovals(prefs?.standingApprovals)}
      />
    </PageLayout>
  );
}
