/**
 * What every sign-in does after the person is known, on either runtime: heal
 * a returning person's onboarding flag and give a person with no workspace
 * their personal org. Failures are logged, never block the sign-in.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getOrgMembershipCount, createPersonalOrg } from "@/db/queries/orgs";
import { getUserById } from "@/db/queries/users";
import { healReturningUserOnboarding } from "@/lib/onboarding-heal";

export async function bootstrapAfterSignIn(user: {
  id: string;
  name?: string | null;
  email?: string | null;
}): Promise<void> {
  try {
    const existing = await getUserById(user.id);
    if (existing) await healReturningUserOnboarding(existing);
    if ((await getOrgMembershipCount(user.id)) === 0) {
      const displayName = user.name ?? user.email?.split("@")[0] ?? "user";
      await createPersonalOrg(user.id, displayName);
    }
  } catch (e) {
    db.execute(
      sql`
      INSERT INTO debug_logs (source, level, message, meta)
      VALUES ('auth', 'event:signIn-org-bootstrap', ${(e as Error)?.message ?? String(e)},
              ${JSON.stringify({ userId: user.id, name: (e as Error)?.name })}::jsonb)
    `,
    ).catch(() => {});
  }
}
