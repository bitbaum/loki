/**
 * A person AccountKit created itself (a first OrangeCat or bitbaum sign-in)
 * gets Loki's `users` row under the same id and their personal org, so every
 * Loki table can reference them. Linking OrangeCat to an existing person
 * records the actor id, as the Auth.js signIn event does. Idempotent:
 * AccountKit may call this more than once for one person.
 */
import { and, eq, isNull } from "drizzle-orm";
import { ORANGECAT_PROVIDER_ID } from "@bitbaum/accountkit/orangecat";
import { db } from "@/db";
import { authUsers } from "@/db/schema/accountkit";
import { users } from "@/db/schema";
import { isValidUuid } from "@/lib/utils";
import { bootstrapAfterSignIn } from "../bootstrap";

export async function ensureLokiUser(account: {
  userId: string;
  providerId: string;
  accountId: string;
}): Promise<void> {
  const actorId =
    account.providerId === ORANGECAT_PROVIDER_ID && isValidUuid(account.accountId)
      ? account.accountId
      : null;
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, account.userId))
    .limit(1);
  if (existing) {
    if (actorId) {
      await db
        .update(users)
        .set({ orangecatActorId: actorId, updatedAt: new Date() })
        .where(and(eq(users.id, account.userId), isNull(users.orangecatActorId)));
    }
    return;
  }
  const [shared] = await db
    .select({ email: authUsers.email, name: authUsers.name, verified: authUsers.emailVerified })
    .from(authUsers)
    .where(eq(authUsers.id, account.userId))
    .limit(1);
  if (!shared) return;
  // An address from a provider is never proof (AccountKit gives OIDC people a
  // `.invalid` placeholder), and Loki keeps no placeholder: such a person has
  // no address until they add one.
  const email = shared.email.endsWith(".invalid") ? null : shared.email;
  await db
    .insert(users)
    .values({
      id: account.userId,
      email,
      name: shared.name || null,
      emailVerified: shared.verified && email ? new Date() : null,
      orangecatActorId: actorId,
    })
    .onConflictDoNothing();
  await bootstrapAfterSignIn({ id: account.userId, name: shared.name, email });
}
