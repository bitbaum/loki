import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { AdapterUser } from "next-auth/adapters";
import { isPlaceholderEmail, type OrangecatUserStore } from "@bitbaum/accountkit/orangecat";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { isValidUuid } from "@/lib/utils";

type UserRow = typeof users.$inferSelect;

/** What Auth.js may see of a user: never the password or PIN hash. */
function toAdapterUser(row: UserRow | undefined): AdapterUser | null {
  if (!row) return null;
  const { passwordHash: _p, privateZonePinHash: _pin, ...user } = row;
  return user as unknown as AdapterUser;
}

/**
 * The database half of "Sign in with OrangeCat" — the rule itself is
 * @bitbaum/accountkit/orangecat's withOrangecatIdentity, wrapped around the
 * Drizzle adapter in src/auth.ts.
 *
 * An OrangeCat sign-in resolves its user by the OIDC `sub` (OrangeCat's actor
 * id) and NOTHING else: users.orangecatActorId first, then the accounts row a
 * link from before that column existed left behind. Never by email —
 * OrangeCat's backend auto-confirms addresses, so a matching email string
 * proves nothing about who is signing in.
 *
 * A new OrangeCat user keeps its OrangeCat address when no Loki account holds
 * it. Where accountkit would store a `.invalid` placeholder, Loki stores null
 * (users.email is nullable): a made-up address never shows in the account
 * menu or receives a reset link.
 */
export const orangecatUserStore: OrangecatUserStore<AdapterUser> = {
  async findBySub(sub) {
    if (isValidUuid(sub)) {
      const byActor = await db.query.users.findFirst({ where: eq(users.orangecatActorId, sub) });
      if (byActor) return toAdapterUser(byActor);
    }
    const [linked] = await db
      .select({ user: users })
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(and(eq(accounts.provider, "orangecat"), eq(accounts.providerAccountId, sub)))
      .limit(1);
    return toAdapterUser(linked?.user);
  },
  async emailTaken(email) {
    const row = await db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${email.toLowerCase()}`,
      columns: { id: true },
    });
    return Boolean(row);
  },
  async insert({ orangecatSub, email, name, image }) {
    const [row] = await db
      .insert(users)
      .values({
        email: isPlaceholderEmail(email) ? null : email,
        name,
        image,
        orangecatActorId: isValidUuid(orangecatSub) ? orangecatSub : null,
      })
      .returning();
    const created = toAdapterUser(row);
    if (!created) throw new Error("user insert returned no row");
    return created;
  },
  async attachSub(userId, sub) {
    if (!isValidUuid(sub)) return true; // nothing to record; the accounts row is the link
    const rows = await db
      .update(users)
      .set({ orangecatActorId: sub })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.orangecatActorId), eq(users.orangecatActorId, sub)),
        ),
      )
      .returning({ id: users.id });
    return rows.length > 0;
  },
};
