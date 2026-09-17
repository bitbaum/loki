import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { listInvitations } from "@/db/queries/invitations";
import { getUserById } from "@/db/queries/users";
import { getUserPreferences, EMPTY_USER_PREFERENCES } from "@/db/queries/user-preferences";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { PageLayout } from "@/components/ui/page-layout";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { getProjectLimit, isUnlimitedProjects } from "@/lib/plan";
import { ROUTES } from "@/config/auth";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect(ROUTES.SIGN_IN);

  const [projects, teamProjects, user, invitations, userPrefs] = await Promise.all([
    getUserProjects(session.user.id),
    getOrgProjects(session.user.id),
    getUserById(session.user.id),
    listInvitations(session.user.id),
    getUserPreferences(session.user.id).catch(() => null),
  ]);

  if (!user) redirect(ROUTES.SIGN_IN);

  return (
    <PageLayout title="Settings" maxWidth="max-w-4xl">
      <SettingsTabs
        user={{
          id: user.id,
          name: user.name ?? "",
          username: user.username ?? "",
          image: user.image ?? "",
          email: user.email,
          hasPassword: !!user.passwordHash,
          plan: user.plan,
          planStatus: user.planStatus ?? null,
        }}
        userPrefs={userPrefs ?? EMPTY_USER_PREFERENCES}
        projects={projects}
        teamProjects={teamProjects}
        projectLimit={
          user.isDefault || isUnlimitedProjects(user.plan) ? null : getProjectLimit(user.plan)
        }
        invitations={invitations}
        orangecatEnabled={getEnabledAuthProviders().orangecat}
      />
    </PageLayout>
  );
}
