import { auth } from "@/auth";
import { ClaimFeedback } from "@/components/feedback/ClaimFeedback";
import { ReporterFeedbackCard } from "@/components/feedback/ReporterFeedbackCard";
import { PageLayout } from "@/components/ui/page-layout";
import { getReporterFeedbackById } from "@/db/queries/site-feedback";
import { attachReporterView } from "@/lib/feedback/attach-reporter-view";
import { verifyFeedbackClaimToken } from "@/lib/feedback/claim-token";

export const metadata = { title: "Your note", robots: { index: false } };

/**
 * Where a note goes after it is sent — for the person who wrote it, with no
 * account.
 *
 * The link (the widget's "Track what happens next", the mail sent to the
 * address they left) used to open on "Create a free account": the only way
 * to see what had happened to what you said was to sign up first. Now it
 * opens on the note itself, where it has got to, in the reporter's words
 * (reporter-view.ts — nothing of the owner's machinery). The signed link
 * names one report and shows nothing else. An account stays one tap below,
 * for someone who wants their notes kept together.
 */
export default async function ClaimFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const session = await auth();
  const id = token ? verifyFeedbackClaimToken(token) : null;
  const item = id ? await getReporterFeedbackById(id).catch(() => null) : null;
  const [row] = item ? await attachReporterView([item]).catch(() => []) : [];

  return (
    <PageLayout title="Your note" maxWidth="max-w-xl">
      {row ? (
        <div className="space-y-4">
          <ReporterFeedbackCard row={row} />
          <section className="ui-card space-y-3 p-5" aria-label="Keep your notes together">
            <p className="text-sm text-text-secondary">
              This page shows where your note is, any time — keep the link. If you want all your
              notes in one place, you can also keep them in a free account.
            </p>
            {token && <ClaimFeedback token={token} signedIn={Boolean(session?.user)} />}
          </section>
        </div>
      ) : (
        <div className="ui-card space-y-2 p-5">
          <p className="font-medium text-text-primary">This link no longer opens your note.</p>
          <p className="text-sm text-text-secondary">
            It may be incomplete or older than six months. Your note is still with the people who
            build the site — nothing more is needed from you.
          </p>
        </div>
      )}
    </PageLayout>
  );
}
