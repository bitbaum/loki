/**
 * Wipe and re-seed the demo tenant.
 *
 * Called by scripts/seed-demo.ts (first install) and by the nightly cron in
 * src/app/api/crons/reset-demo/route.ts. Both go through here so "what the demo
 * contains" has one definition.
 *
 * ── Why the wipe is written this way ─────────────────────────────────────────
 * The obvious implementation is `DELETE FROM users WHERE email = demo` and let
 * ON DELETE CASCADE clean up. That does not work here: most of this schema
 * references users.id with no delete rule at all, so the delete either fails on
 * a foreign-key violation or, worse, succeeds against tables that DO cascade and
 * leaves the rest orphaned — rows owned by a user id that no longer exists.
 * This fleet has already shipped that bug once (73% of one table turned out to
 * be orphans).
 *
 * The second-obvious implementation is a hand-written list of deleteMany calls
 * in dependency order. That is what aoz-begleitung had, and it silently went stale
 * the moment someone added a table: the reset kept reporting success while
 * leaving rows behind.
 *
 * So the child tables are read from the LIVE FOREIGN-KEY CATALOG instead. Every
 * constraint that points at public.users is discovered at run time, which means
 * a table added next month is included without anyone remembering. Deletion runs
 * in repeated passes until a pass changes nothing, so no dependency order has to
 * be derived or maintained — rows blocked by another FK this pass simply go in
 * the next one.
 *
 * ── Why the guards are what they are ─────────────────────────────────────────
 * This function DELETES A USER AND EVERYTHING THEY OWN. On this instance the
 * neighbouring rows are George's real fleet. So it refuses unless the demo is
 * explicitly enabled, and it resolves its target by the demo email alone —
 * it never accepts a user id from a caller, because the one way this becomes a
 * catastrophe is a caller passing the wrong id.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/password";
import { DEMO_EMAIL, DEMO_NAME, DEMO_PASSWORD, DEMO_USERNAME, isDemoEnabled } from "@/config/demo";
import { forgetDemoUserId } from "@/lib/demo-guard";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { ORCHESTRATION_OUTCOME } from "@/db/schema/orchestration-runs";

export class DemoDisabledError extends Error {
  constructor() {
    super("Demo access is not enabled on this instance (DEMO_ACCESS_ENABLED != 1).");
    this.name = "DemoDisabledError";
  }
}

type ChildRef = { table: string; column: string };

/**
 * Every (table, column) in the public schema whose foreign key points at
 * public.users. Read live so the reset cannot fall behind the schema.
 */
async function userChildRefs(): Promise<ChildRef[]> {
  const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema    = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
      AND ccu.table_name     = 'users'
      AND ccu.column_name    = 'id'
  `);
  // Drizzle's postgres-js driver returns the rows array directly.
  return [...rows].map((r) => ({ table: r.table_name, column: r.column_name }));
}

/** Quote an identifier read from the catalog — belt and braces, not user input. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`refusing unsafe identifier: ${name}`);
  return `"${name}"`;
}

/**
 * Delete every row owned by `userId`, then the user. Returns rows removed per
 * table, so the cron can log what it actually did rather than "ok".
 *
 * Exported for scripts/seed-showcase.ts, the only other caller. The rule in
 * the header binds it too: pass only an id resolved from a FIXED email inside
 * the calling module, never one handed in from outside.
 */
export async function wipeUserRows(userId: string): Promise<Record<string, number>> {
  const refs = await userChildRefs();
  const removed: Record<string, number> = {};

  // Repeated passes until nothing changes: a row blocked by another table's FK
  // this pass is deletable once that table has been cleared. Bounded so a
  // genuine cycle fails loudly instead of spinning.
  let remaining = [...refs];
  for (let pass = 0; pass < 10 && remaining.length > 0; pass++) {
    const stillBlocked: ChildRef[] = [];
    let progressed = false;

    for (const ref of remaining) {
      try {
        const res = await db.execute(
          sql.raw(`DELETE FROM ${ident(ref.table)} WHERE ${ident(ref.column)} = '${userId}'`),
        );
        const n = (res as unknown as { count?: number }).count ?? 0;
        if (n > 0) removed[ref.table] = (removed[ref.table] ?? 0) + n;
        progressed = true;
      } catch {
        stillBlocked.push(ref); // blocked by a child of its own — retry next pass
      }
    }

    remaining = stillBlocked;
    if (!progressed) break; // no pass made progress: report below
  }

  if (remaining.length > 0) {
    throw new Error(
      `user wipe could not clear: ${remaining.map((r) => `${r.table}.${r.column}`).join(", ")}`,
    );
  }

  await db.delete(users).where(eq(users.id, userId));
  return removed;
}

/**
 * Resolve the demo user strictly by email. Never takes an id from a caller —
 * see the header.
 */
async function findDemoUserId(): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL))
    .limit(1);
  return row?.id ?? null;
}

export type DemoResetResult = {
  userId: string;
  removed: Record<string, number>;
  seeded: Record<string, number>;
};

/**
 * The whole cycle: remove the previous demo tenant, create a fresh one, fill it.
 *
 * The user row is recreated rather than reused. That re-mints the id, which
 * orphans any JWT still carrying the old one — sessions from before a reset stop
 * resolving, and a visitor mid-tour is signed out. That is the deliberate trade:
 * a stable id would mean drive-by edits survive by pointing at rows the wipe
 * removed. The sign-in button makes recovery one click, and forgetDemoUserId()
 * below keeps the in-process guard cache from authorising against the dead id.
 */
export async function resetDemoTenant(): Promise<DemoResetResult> {
  if (!isDemoEnabled()) throw new DemoDisabledError();

  const existing = await findDemoUserId();
  const removed = existing ? await wipeUserRows(existing) : {};

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [created] = await db
    .insert(users)
    .values({
      name: DEMO_NAME,
      email: DEMO_EMAIL,
      username: DEMO_USERNAME,
      passwordHash,
      // Pre-verified and pre-onboarded: the demo exists to skip exactly these
      // steps. A visitor who has to complete onboarding has not seen the product.
      emailVerified: new Date(),
      onboardedAt: new Date(),
    })
    .returning({ id: users.id });

  forgetDemoUserId();

  const seeded = await seedDemoContent(created.id);
  return { userId: created.id, removed, seeded };
}

/**
 * What a visitor actually sees. Kept deliberately small and hand-written: the
 * demo has to read as a fleet that has been RUNNING, not as three empty cards,
 * and every row here is fiction — no real project, person or repo appears.
 */
async function seedDemoContent(userId: string): Promise<Record<string, number>> {
  const { entities, userProjects, prompts, goals, habits, commitments, orchestrationRuns } =
    await import("@/db/schema");

  const counts: Record<string, number> = {};
  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000);

  const projectFixtures = [
    {
      name: "harbourlight",
      description:
        "Tide-aware scheduling for a small marina. Booking, billing, and a public availability board.",
      stack: "Next.js · Postgres · Stripe",
      liveUrl: "https://harbourlight.example",
      notes: "Berth conflicts were the whole problem. Everything else is reporting.",
    },
    {
      name: "kestrel",
      description:
        "Field-survey capture for ecologists — offline-first, syncs when a signal appears.",
      stack: "React Native · SQLite · Expo",
      liveUrl: null,
      notes: "Offline conflict resolution is the only hard part. Last-write-wins is wrong here.",
    },
    {
      name: "ledgerpost",
      description: "Double-entry bookkeeping for tiny co-ops, with a plain-language audit trail.",
      stack: "TypeScript · Postgres",
      liveUrl: "https://ledgerpost.example",
      notes: "Money must balance. Every feature is downstream of that.",
    },
  ];

  const projectIds: { entityId: string; name: string }[] = [];
  for (const [i, p] of projectFixtures.entries()) {
    const [entity] = await db
      .insert(entities)
      .values({
        userId,
        name: p.name,
        type: "project",
        description: p.description,
        source: "demo-seed",
      })
      .returning({ id: entities.id });

    await db.insert(userProjects).values({
      userId,
      entityProjectId: entity.id,
      name: p.name,
      description: p.description,
      stack: p.stack,
      liveUrl: p.liveUrl,
      notes: p.notes,
      position: i,
      isActive: true,
    });

    projectIds.push({ entityId: entity.id, name: p.name });
  }
  counts.projects = projectFixtures.length;

  // Closed runs, so Activity and Control have real history to read rather than
  // a spinner and an empty state. The summary shape is the same five-field
  // contract the real loop writes (OrchestrationTaskSummary) — a demo that
  // rendered a different shape would teach the wrong thing about the product.
  const runFixtures = [
    {
      p: 0,
      intent: "test_and_fix",
      outcome: ORCHESTRATION_OUTCOME.SUCCESS,
      days: 0.2,
      done: "Berth double-booking rejected at the constraint, not in the form.",
      next: "Backfill the three historical overlaps flagged by the new check.",
      tests: "green — 214 passed",
      todos: "0 open",
      health: "healthy",
    },
    {
      p: 0,
      intent: "product",
      outcome: ORCHESTRATION_OUTCOME.SUCCESS,
      days: 1.1,
      done: "Availability board renders tide windows 14 days out, cached hourly.",
      next: "Decide whether the board should show provisional bookings.",
      tests: "green — 214 passed",
      todos: "1 open",
      health: "healthy",
    },
    {
      p: 1,
      intent: "test_and_fix",
      outcome: ORCHESTRATION_OUTCOME.PARTIAL,
      days: 2.4,
      done: "Sync conflict resolution reworked around a per-field clock.",
      next: "Two of five edge cases still drop the field note — reproduce case 4 first.",
      tests: "3 failing",
      todos: "2 open",
      health: "needs attention",
    },
    {
      p: 2,
      intent: "product",
      outcome: ORCHESTRATION_OUTCOME.SUCCESS,
      days: 3.0,
      done: "Audit trail reads in plain language; each entry links to its transaction.",
      next: "Translate the entry templates.",
      tests: "green — 96 passed",
      todos: "0 open",
      health: "healthy",
    },
    {
      p: 2,
      intent: "quality",
      outcome: ORCHESTRATION_OUTCOME.SUCCESS,
      days: 5.5,
      done: "Dependency sweep: 31 updates, no behaviour change.",
      next: "Nothing queued.",
      tests: "green — 96 passed",
      todos: "0 open",
      health: "healthy",
    },
  ] as const;

  for (const r of runFixtures) {
    await db.insert(orchestrationRuns).values({
      userId,
      projectId: projectIds[r.p].entityId,
      adapter: "claude",
      intent: r.intent,
      state: ORCH_STATE.CLOSED,
      outcome: r.outcome,
      projectKey: projectIds[r.p].name,
      projectPath: `/demo/${projectIds[r.p].name}`,
      summary: { done: r.done, next: r.next, tests: r.tests, todos: r.todos, health: r.health },
      startedAt: daysAgo(r.days),
      finishedAt: daysAgo(r.days - 0.02),
    });
  }
  counts.runs = runFixtures.length;

  const promptFixtures = [
    {
      name: "Tighten the failing test",
      description: "Fix the cause, not the assertion.",
      body: "Find the failing test, explain in one sentence why it fails, then fix the cause rather than the assertion.",
    },
    {
      name: "Explain this module",
      description: "Ownership, dependencies, blast radius.",
      body: "Summarise what this module owns, what it depends on, and what would break if it were deleted.",
    },
    {
      name: "Find the wrong predicate",
      description: "The bug class behind repeat fixes.",
      body: "Look for conditions that approximate the real rule — a width standing in for pointer type, a class standing in for a capability.",
    },
  ];
  for (const p of promptFixtures) {
    await db
      .insert(prompts)
      .values({ userId, name: p.name, description: p.description, body: p.body });
  }
  counts.prompts = promptFixtures.length;

  const goalFixtures = [
    { title: "Ship harbourlight billing", progress: 60 },
    { title: "Kestrel offline sync solid", progress: 35 },
  ];
  for (const g of goalFixtures) {
    await db.insert(goals).values({ userId, title: g.title, progress: g.progress });
  }
  counts.goals = goalFixtures.length;

  for (const [i, title] of ["Read before writing", "Close one loop a day"].entries()) {
    await db.insert(habits).values({ userId, title, sortOrder: i });
  }
  counts.habits = 2;

  await db.insert(commitments).values({
    userId,
    description: "Review the kestrel sync trade-off before the next field trip",
    dueDate: daysAgo(-2),
  });
  counts.commitments = 1;

  return counts;
}
