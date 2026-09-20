import { db } from "@/db";
import {
  users,
  actions,
  alerts,
  claudeCodeHistory,
  commitments,
  entities,
  entityRelations,
  events,
  goals,
  habitCompletions,
  habits,
  interactions,
  invitations,
  orchestrationRuns,
  promptHistory,
  siteFeedback,
  subscriptions,
  attributes,
} from "@/db/schema";
import { eq, count } from "drizzle-orm";
import type { Plan, PlanStatus } from "@/db/schema/users";

export async function getUserById(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) }) ?? null;
}

export async function getUserByUsername(username: string) {
  return db.query.users.findFirst({ where: eq(users.username, username) }) ?? null;
}

export async function getUserByEmail(email: string) {
  return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase().trim()) }) ?? null;
}

export async function createUser(data: { name: string; email: string; passwordHash: string }) {
  const [user] = await db
    .insert(users)
    .values({
      name: data.name,
      email: data.email.toLowerCase().trim(),
      passwordHash: data.passwordHash,
      // onboardedAt set server-side by POST /api/onboarding when username is valid
    })
    .returning({ id: users.id });
  return user;
}

export async function getDefaultUser() {
  return db.query.users.findFirst({ where: eq(users.isDefault, true) }) ?? null;
}

/**
 * Does this account run THIS Loki instance?
 *
 * `is_default` is set once, by createInitialUser, for the account made at
 * /setup — so it already means "whoever installed this instance", which is
 * exactly who may curate its public face. On loki.orangecat.ch that is the
 * founder; on a self-hosted Loki it is that operator. No new role table for a
 * question the data already answers.
 *
 * This is deliberately NOT "is a tenant" — featuring puts a project on the
 * homepage, so letting any tenant set it would make the shop window
 * first-come. Consent is the tenant's decision; featuring is the operator's.
 * See db/queries/public-visibility.ts.
 */
export async function isSiteOperator(userId: string): Promise<boolean> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isDefault: true },
  });
  return row?.isDefault === true;
}

export async function getUserCount(): Promise<number> {
  const [{ value }] = await db.select({ value: count() }).from(users);
  return value;
}

export interface CreateInitialUserInput {
  name: string;
  passwordHash: string;
}

export async function createInitialUser(data: CreateInitialUserInput) {
  const [user] = await db
    .insert(users)
    .values({
      name: data.name,
      passwordHash: data.passwordHash,
      isDefault: true,
      onboardedAt: new Date(),
    })
    .returning({ id: users.id });
  return user;
}

export interface UpdateUserInput {
  username?: string;
  name?: string;
  email?: string | null;
  image?: string | null;
  onboardedAt?: Date;
  emailVerified?: Date | null;
}

export interface UpdateUserBillingInput {
  plan?: Plan;
  planStatus?: PlanStatus | null;
  /** OrangeCat/BTC-rail pass expiry (now + period). Null clears it (e.g. the
   *  expiry cron reverting to free). */
  planExpiresAt?: Date | null;
}

export async function updateUserBilling(id: string, patch: UpdateUserBillingInput) {
  const [updated] = await db
    .update(users)
    .set({
      ...(patch.plan !== undefined && { plan: patch.plan }),
      ...(patch.planStatus !== undefined && { planStatus: patch.planStatus }),
      ...(patch.planExpiresAt !== undefined && { planExpiresAt: patch.planExpiresAt }),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  return updated ?? null;
}

export async function updateUserPasswordHash(id: string, passwordHash: string) {
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));
}

/**
 * Link (or clear) the user's OrangeCat actor — set on every "Login with
 * OrangeCat" sign-in (id_token.sub), see events.signIn in src/auth.ts.
 */
export async function setUserOrangeCatActorId(id: string, orangecatActorId: string | null) {
  await db.update(users).set({ orangecatActorId, updatedAt: new Date() }).where(eq(users.id, id));
}

/** Map an OrangeCat actor id → the Loki user. The entitlement webhook uses
 *  this to resolve which account a Bitcoin payment on OC belongs to. */
export async function getUserByOrangeCatActorId(orangecatActorId: string) {
  return db.query.users.findFirst({ where: eq(users.orangecatActorId, orangecatActorId) }) ?? null;
}

export async function updateUser(id: string, patch: UpdateUserInput) {
  const [updated] = await db
    .update(users)
    .set({
      ...(patch.username !== undefined && { username: patch.username }),
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.email !== undefined && { email: patch.email }),
      ...(patch.image !== undefined && { image: patch.image }),
      ...(patch.onboardedAt !== undefined && { onboardedAt: patch.onboardedAt }),
      ...(patch.emailVerified !== undefined && { emailVerified: patch.emailVerified }),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Permanently delete a user and everything they own (Settings → Danger zone).
 *
 * Most user-owned tables declare onDelete:"cascade" and purge automatically
 * with the users row. The tables below do NOT (plain references(users.id)),
 * so they must be cleared explicitly first or the users delete raises an FK
 * violation. Order matters only around entities: interactions / attributes /
 * entity_relations cascade from entities via entity_id, but each also carries
 * its own non-cascading user_id FK — delete them by user_id before entities
 * so no row survives pointing at the user. Everything runs in one
 * transaction: the account is either fully gone or untouched.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Leaf rows first (non-cascading user_id FKs).
    await tx.delete(siteFeedback).where(eq(siteFeedback.userId, userId));
    await tx.delete(claudeCodeHistory).where(eq(claudeCodeHistory.userId, userId));
    await tx.delete(promptHistory).where(eq(promptHistory.userId, userId));
    await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));
    await tx.delete(alerts).where(eq(alerts.userId, userId));
    await tx.delete(actions).where(eq(actions.userId, userId));
    await tx.delete(commitments).where(eq(commitments.userId, userId));
    await tx.delete(goals).where(eq(goals.userId, userId));
    await tx.delete(events).where(eq(events.userId, userId));
    // orchestration_runs: run_events cascade from it via run_id.
    await tx.delete(orchestrationRuns).where(eq(orchestrationRuns.userId, userId));
    // habits: habit_completions cascade via habit_id, but also clear any
    // completion rows carrying this user_id directly.
    await tx.delete(habitCompletions).where(eq(habitCompletions.userId, userId));
    await tx.delete(habits).where(eq(habits.userId, userId));
    // Knowledge graph: children by user_id, then the entities themselves.
    await tx.delete(interactions).where(eq(interactions.userId, userId));
    await tx.delete(attributes).where(eq(attributes.userId, userId));
    await tx.delete(entityRelations).where(eq(entityRelations.userId, userId));
    await tx.delete(entities).where(eq(entities.userId, userId));
    // invitations.used_by is nullable with no cascade — detach, don't delete
    // (the invite belongs to whoever created it).
    await tx.update(invitations).set({ usedBy: null }).where(eq(invitations.usedBy, userId));
    // Finally the users row — every onDelete:"cascade" table purges with it.
    await tx.delete(users).where(eq(users.id, userId));
  });
}
