import { requirePageUserId } from "@/lib/session";
import { listReporterFeedback } from "@/db/queries/site-feedback";
import { attachReporterView } from "@/lib/feedback/attach-reporter-view";
import { PageLayout } from "@/components/ui/page-layout";
import { MyFeedbackList } from "@/components/feedback/MyFeedbackList";
import { getProjectAccess } from "@/db/queries/project-access";

export const metadata = { title: "My feedback" };

/**
 * The reporter's side of the feedback loop — the only feedback surface whose
 * reader may be a stranger on someone else's site.
 *
 * It renders through the SAME pieces as the operator inbox on purpose. It used
 * to have its own row markup, and the divergence was not theoretical: the
 * three-line clamp shipped to FeedbackItemRow in #783 — in answer to a report
 * filed FROM this page — and never reached here, so the person who asked for
 * it went on seeing their own eight-line report swallow the list while its
 * status read "Being implemented".
 *
 * Status is derived, never the raw DB word: see lib/feedback/reporter-view.ts
 * for what a reporter is told and what stays the operator's.
 */
export default async function MyFeedbackPage() {
  const userId = await requirePageUserId();
  const rows = await attachReporterView(await listReporterFeedback(userId));
  // The reporter who is ALSO the project's owner gets the owner's way forward
  // on the same screen. Access is the same question the inbox asks; asked
  // once per project, not per row.
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const access = await Promise.all(
    projectIds.map(
      async (id) => [id, (await getProjectAccess(userId, id))?.canEdit === true] as const,
    ),
  );
  const canEdit = new Map(access);

  return (
    <PageLayout title="My feedback" maxWidth="max-w-2xl">
      <MyFeedbackList
        rows={rows}
        ownProjectIds={[...canEdit].filter(([, own]) => own).map(([id]) => id)}
      />
    </PageLayout>
  );
}
