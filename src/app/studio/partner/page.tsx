import { auth } from "@/auth";
import { PageLayout } from "@/components/ui/page-layout";
import { COMMISSION } from "@/config/commission";
import { getUserById } from "@/db/queries/users";
import { studioApplicationsForActor } from "@/db/queries/studio-requests";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { continueWithOrangecat, reopenApplication } from "../actions";

export const metadata = { title: "Your builder application" };

/**
 * The way back for an approved builder who lost their private link: sign in
 * with the OrangeCat account they connected, and each application opens
 * again with a fresh link (the old one stops working).
 */
export default async function StudioPartnerPage() {
  const session = await auth();
  const user = session?.user?.id ? await getUserById(session.user.id) : null;
  const applications = user?.orangecatActorId
    ? await studioApplicationsForActor(user.orangecatActorId)
    : null;
  const orangecat = getEnabledAuthProviders().orangecat;
  return (
    <PageLayout title="Your builder application" maxWidth="max-w-xl">
      <div className="ui-card space-y-4 p-5">
        {!applications ? (
          <>
            <p className="text-sm text-text-secondary">
              Approved builders who connected their OrangeCat account can open their application
              here without the private link.
            </p>
            {orangecat ? (
              <form action={continueWithOrangecat.bind(null, "/studio/partner")}>
                <button type="submit" className="ui-btn-primary">
                  Continue with OrangeCat
                </button>
              </form>
            ) : (
              <p className="ui-error">OrangeCat sign-in is not available right now.</p>
            )}
          </>
        ) : applications.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No builder application is connected to this OrangeCat account. Once the studio approves
            you, connect it from your application. Lost the link before that? The portal sends a new
            one to the email you gave.
          </p>
        ) : (
          applications.map((a) => (
            <form key={a.id} action={reopenApplication.bind(null, a.id)} className="space-y-2">
              <p className="font-medium text-text-primary">{a.name ?? "Builder application"}</p>
              <p className="text-sm text-text-secondary">{a.status.title}</p>
              <button type="submit" className="ui-btn-primary">
                Open my application
              </button>
              <p className="text-sm text-text-muted">
                Opening it makes a new private link; the old one stops working.
              </p>
            </form>
          ))
        )}
        <a className="ui-btn-secondary inline-flex" href={`${COMMISSION.studioOrigin}/portal/`}>
          The studio portal
        </a>
      </div>
    </PageLayout>
  );
}
