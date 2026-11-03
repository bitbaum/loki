import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { authAccounts, authUsers } from "@/db/schema/accountkit";
import { redirect } from "next/navigation";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { listInvitations } from "@/db/queries/invitations";
import { getUserById } from "@/db/queries/users";
import { listOcBillingGrants } from "@/db/queries/billing-grants";
import { getUserPreferences, EMPTY_USER_PREFERENCES } from "@/db/queries/user-preferences";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { PageLayout } from "@/components/ui/page-layout";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { accountKitMethods } from "@/lib/auth/shared/screens";
import { getProjectLimit, isUnlimitedProjects } from "@/lib/plan";
import { orangeCatPayUrl } from "@/lib/oc-pay";
import { PRICING_PLANS } from "@/config/plans";
import type { Plan } from "@/db/schema/users";
import { ROUTES } from "@/config/auth";
import { getPlanReservation } from "@/db/queries/plan-reservations";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect(ROUTES.SIGN_IN);

  const [projects, teamProjects, user, invitations, userPrefs, grants, reservation] =
    await Promise.all([
      getUserProjects(session.user.id),
      getOrgProjects(session.user.id),
      getUserById(session.user.id),
      listInvitations(session.user.id),
      getUserPreferences(session.user.id).catch(() => null),
      listOcBillingGrants(session.user.id).catch(() => []),
      getPlanReservation(session.user.id).catch(() => null),
    ]);

  if (!user) redirect(ROUTES.SIGN_IN);

  // AccountKit's account panel (ways in, passkeys, second factor, leaving)
  // exists on the AccountKit runtime only.
  const methods = accountKitMethods();
  const shared = methods
    ? (
        await db
          .select({
            twoFactorEnabled: authUsers.twoFactorEnabled,
            emailVerified: authUsers.emailVerified,
            role: authUsers.role,
          })
          .from(authUsers)
          .where(eq(authUsers.id, user.id))
          .limit(1)
          .catch(() => [])
      )[0]
    : undefined;
  const security =
    methods && shared
      ? {
          methods,
          twoFactorEnabled: Boolean(shared.twoFactorEnabled),
          emailVerified: Boolean(shared.emailVerified),
          role: shared.role ?? "member",
          linked: (
            await db
              .select({ provider: authAccounts.providerId })
              .from(authAccounts)
              .where(eq(authAccounts.userId, user.id))
              .catch(() => [])
          ).map((row) => row.provider),
        }
      : null;

  // The Bitcoin checkout per plan comes from env, so it is resolved here and
  // handed down: the tabs are a client component and cannot read it.
  const payUrls: Partial<Record<Plan, string>> = {};
  for (const p of PRICING_PLANS) {
    const url = orangeCatPayUrl(p.key);
    if (url) payUrls[p.key] = url;
  }

  return (
    <PageLayout title="Settings" maxWidth="max-w-4xl">
      <SettingsTabs
        user={{
          id: user.id,
          name: user.name ?? "",
          username: user.username ?? "",
          image: user.image ?? "",
          email: user.email,
          // On AccountKit the password is its credential row (a person who
          // signed up there has none in users.password_hash).
          hasPassword: security ? security.linked.includes("credential") : !!user.passwordHash,
          plan: user.plan,
          cloudBuilder: !!user.isDefault || user.privateBuilder,
          operator: !!user.isDefault,
        }}
        billing={{
          plan: user.plan,
          planStatus: user.planStatus ?? null,
          planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
          grants: [...grants].reverse().map((g) => ({
            id: g.id,
            plan: g.plan,
            periodDays: g.periodDays,
            expiresAt: g.expiresAt.toISOString(),
            createdAt: g.createdAt.toISOString(),
            amountBtc: g.amountBtc,
          })),
          payUrls,
          reservedPlan: reservation?.plan ?? null,
        }}
        userPrefs={userPrefs ?? EMPTY_USER_PREFERENCES}
        projects={projects}
        teamProjects={teamProjects}
        projectLimit={
          user.isDefault || isUnlimitedProjects(user.plan) ? null : getProjectLimit(user.plan)
        }
        invitations={invitations}
        orangecatEnabled={getEnabledAuthProviders().orangecat}
        security={security}
      />
    </PageLayout>
  );
}
