import { auth } from "@/auth";
import { ClaimFeedback } from "@/components/feedback/ClaimFeedback";
import { PageLayout } from "@/components/ui/page-layout";

export const metadata = { title: "Track feedback" };

export default async function ClaimFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const session = await auth();
  return (
    <PageLayout title="Track your feedback" maxWidth="max-w-xl">
      <div className="ui-card space-y-3 p-5">
        <p className="text-sm text-text-secondary">
          See when your report is reviewed, implemented, and shipped. An account only grants access
          to feedback you submitted; project editing remains limited to its owners and editors.
        </p>
        {token ? (
          <ClaimFeedback token={token} signedIn={Boolean(session?.user)} />
        ) : (
          <p className="ui-error">This tracking link is incomplete.</p>
        )}
      </div>
    </PageLayout>
  );
}
