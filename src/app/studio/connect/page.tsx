import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageLayout } from "@/components/ui/page-layout";
import { COMMISSION } from "@/config/commission";
import { getUserById } from "@/db/queries/users";
import { connectStudioOrangecat } from "@/db/queries/studio-requests";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { StudioConflict } from "@/lib/studio/policy";
import { verifyStudioConnectToken } from "@/lib/studio/orangecat-link";
import { continueWithOrangecat } from "../actions";

export const metadata = { title: "Connect OrangeCat" };

/**
 * An approved partner arrives from their portal with a short-lived signed
 * link. Signed in with OrangeCat, the application is tied to that identity
 * and they go straight back to the portal; otherwise one button signs them in.
 */
export default async function StudioConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const requestId = token ? verifyStudioConnectToken(token) : null;
  const portal = `${COMMISSION.studioOrigin}/portal/`;
  let problem: string | null = null;
  let signInNeeded = false;
  if (!requestId) {
    problem =
      "This link has expired or is incomplete. Open your application and press Connect again; it takes a minute.";
  } else {
    const session = await auth();
    const user = session?.user?.id ? await getUserById(session.user.id) : null;
    if (!user?.orangecatActorId) signInNeeded = true;
    else {
      try {
        await connectStudioOrangecat(requestId, user.orangecatActorId);
      } catch (error) {
        problem =
          error instanceof StudioConflict ? error.message : "Connecting failed. Please try again.";
      }
      if (!problem) redirect(portal);
    }
  }
  const orangecat = getEnabledAuthProviders().orangecat;
  const here = `/studio/connect?token=${encodeURIComponent(token ?? "")}`;
  return (
    <PageLayout title="Connect your OrangeCat account" maxWidth="max-w-xl">
      <div className="ui-card space-y-4 p-5">
        {problem ? (
          <p className="ui-error">{problem}</p>
        ) : (
          <p className="text-sm text-text-secondary">
            Your partner profile will belong to your OrangeCat account. If you lose your private
            link, signing in with OrangeCat opens your application again. Nothing else about your
            application changes.
          </p>
        )}
        {signInNeeded &&
          (orangecat ? (
            <form action={continueWithOrangecat.bind(null, here)}>
              <button type="submit" className="ui-btn-primary">
                Continue with OrangeCat
              </button>
            </form>
          ) : (
            <p className="ui-error">
              OrangeCat sign-in is not available right now. Your application is unaffected.
            </p>
          ))}
        <a className="ui-btn-secondary inline-flex" href={portal}>
          Back to your application
        </a>
      </div>
    </PageLayout>
  );
}
