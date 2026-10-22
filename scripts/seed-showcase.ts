/**
 * Seed a LOCAL account whose data looks like the owner's, so a designer or an
 * agent sees the app the way he does: dozens of projects with junk folder
 * names, a feedback queue in the seventies, failed runs, stale notifications,
 * duplicated prompts, long chat history. The public demo (seed-demo.ts) is
 * three tidy projects, and on it most pages look empty — their real problems
 * (long lists, failures, old alerts, ugly names) never show.
 *
 *   pnpm run seed:showcase            (reads DATABASE_URL from .env.local)
 *
 * Then sign in at /sign-in with
 *
 *   email     owner@loki.local
 *   password  showcase-owner
 *
 * or audit every page as that account:
 *
 *   BASE=http://localhost:3000 AUDIT_EMAIL=owner@loki.local \
 *     AUDIT_PASSWORD=showcase-owner node scripts/audit-pages.mjs .tmp/audit
 *
 * Idempotent: a re-run deletes this account and everything it owns (through
 * the same live-foreign-key wipe the demo reset uses) and seeds it again.
 * Nobody else's rows are touched. Timestamps are relative to now, spread over
 * the last 60 days, so the data never goes stale however late it is re-run.
 *
 * GUARDED: it refuses unless every database URL it would use points at
 * localhost, refuses the prod tunnel's port (scripts/db-tunnel.sh), and
 * refuses a database that already has an operator account — a real instance
 * reached some other way. The account is made the operator (users.is_default)
 * because the owner is one, and the operator sees surfaces nobody else does.
 *
 * Every name below is fiction or the owner's own project names; no real
 * person, address or secret appears.
 */
import { config } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
import {
  ACTIONS,
  AOZ_FEEDBACK,
  AOZ_PAGES,
  ALERTS,
  COMMITMENTS,
  CREW_TASKS,
  EVENTS,
  FEEDBACK_PLAN,
  GOALS,
  HABITS,
  PACKAGE_VERSIONS,
  PERSON_FIXTURES,
  PROJECTS,
  PROMPTS,
  RUN_FAILURES,
  RUN_SUCCESSES,
  SCHEDULED_JOBS,
  SITE_FEEDBACK,
  SITE_PAGES,
  SUBSCRIPTIONS,
  THREADS,
  type ProjectFixture,
} from "./seed-showcase-fixtures";

config({ path: ".env.local" });

const SHOWCASE_EMAIL = "owner@loki.local";
const SHOWCASE_PASSWORD = "showcase-owner";
const SHOWCASE_NAME = "Cato";
const SHOWCASE_USERNAME = "cato";
const TUNNEL_PORT = process.env.TUNNEL_PORT ?? "15432";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// ── Guard ────────────────────────────────────────────────────────────────────

function refuse(why: string): never {
  console.error(`seed-showcase refused: ${why}`);
  process.exit(2);
}

function assertLocalDatabase(): void {
  const urls = [process.env.DATABASE_URL, process.env.DATABASE_POOL_URL]
    .map((u) => u?.trim())
    .filter((u): u is string => Boolean(u));
  if (urls.length === 0) refuse("DATABASE_URL is not set.");
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      refuse("a database URL could not be parsed.");
    }
    if (!LOCAL_HOSTS.has(url.hostname)) {
      refuse(`the database host is "${url.hostname}", not localhost. This script is local-only.`);
    }
    if (url.port === TUNNEL_PORT) {
      refuse(`port ${TUNNEL_PORT} is the production tunnel (scripts/db-tunnel.sh).`);
    }
  }
}

// ── Time and chance ──────────────────────────────────────────────────────────

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (days: number) => new Date(NOW - days * DAY);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Seeded so a re-run produces the same shape (mulberry32). */
let seed = 0x10c1;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const token = (bytes = 16) => randomBytes(bytes).toString("hex");

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  assertLocalDatabase();

  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { and, eq, ne } = await import("drizzle-orm");
  const { hashPassword } = await import("../src/lib/password");
  const { wipeUserRows } = await import("../src/lib/demo-seed");
  const { ensureDefaultVacuums } = await import("../src/db/queries/robots");
  const { CREW_ATTR } = await import("../src/config/actors");

  // A second operator means this is not a scratch database.
  const [otherOperator] = await db
    .select({ email: s.users.email })
    .from(s.users)
    .where(and(eq(s.users.isDefault, true), ne(s.users.email, SHOWCASE_EMAIL)))
    .limit(1);
  if (otherOperator) {
    refuse(
      `this database already has an operator (${otherOperator.email}). ` +
        "That is a real instance, not a scratch one.",
    );
  }

  // Resolve strictly by the fixed email — see wipeUserRows.
  const [existing] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.email, SHOWCASE_EMAIL))
    .limit(1);
  const removed = existing ? await wipeUserRows(existing.id) : {};
  const removedTotal = Object.values(removed).reduce((a, b) => a + b, 0);

  const [user] = await db
    .insert(s.users)
    .values({
      name: SHOWCASE_NAME,
      email: SHOWCASE_EMAIL,
      username: SHOWCASE_USERNAME,
      passwordHash: await hashPassword(SHOWCASE_PASSWORD),
      emailVerified: ago(60),
      onboardedAt: ago(60),
      isDefault: true,
      privateBuilder: true,
      plan: "pro",
      planStatus: "active",
      createdAt: ago(60),
    })
    .returning({ id: s.users.id });
  const userId = user.id;
  const counts: Record<string, number> = {};
  const count = (table: string, n: number) => (counts[table] = (counts[table] ?? 0) + n);

  // ── Settings ──
  await db.insert(s.userPreferences).values({
    userId,
    homeCity: "Zurich",
    homeTimezone: "Europe/Zurich",
    homeLocale: "en-CH",
    theme: "light",
    previewCode: "showcase",
  });
  await db.insert(s.beaconSettings).values({ userId, autoInjectMode: "on", nightRuns: 3 });
  count("user_preferences", 1);
  count("beacon_settings", 1);

  // ── Projects ──
  type Seeded = {
    fx: ProjectFixture;
    entityId: string;
    upId: string;
    path: string | null;
    createdDays: number;
  };
  const projects: Seeded[] = [];
  for (const [i, fx] of PROJECTS.entries()) {
    const slug = fx.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const createdDays = Math.round(between(8, 60));
    const gitUrl = fx.disconnected ? null : `https://github.com/bitbaum/${slug}`;
    const path = fx.disconnected ? null : `/srv/loki/projects/${slug}`;
    const liveUrl = fx.live
      ? fx.clientWork
        ? `https://${slug.slice(0, 40)}.orangecat.ch`
        : `https://${slug}.ch`
      : null;

    const [entity] = await db
      .insert(s.entities)
      .values({
        userId,
        name: fx.name,
        title: fx.title ?? null,
        type: "project",
        description: fx.description,
        gitUrl,
        autoInjectModeOverride: fx.paused ? "off" : null,
        source: "showcase-seed",
        createdAt: ago(createdDays),
        updatedAt: ago(between(0, createdDays)),
      })
      .returning({ id: s.entities.id });

    const devLog =
      fx.live && !fx.disconnected
        ? RUN_SUCCESSES.slice(0, 3).map((r, k) => ({
            date: isoDate(ago(k * 6 + 2)),
            done: r.done,
            next: r.next,
            tests: "green",
            todos: `${k} open`,
            health: "healthy",
          }))
        : [];

    const [up] = await db
      .insert(s.userProjects)
      .values({
        userId,
        entityProjectId: entity.id,
        name: fx.name,
        dirPath: path,
        gitUrl,
        liveUrl,
        description: fx.description,
        stack: fx.stack ?? null,
        builderPref: null,
        packageUpdates: fx.updates ?? "auto",
        position: i,
        slug,
        clientWork: fx.clientWork ?? null,
        autoShip: fx.clientWork ? false : null,
        devLog,
        createdAt: ago(createdDays),
        updatedAt: ago(between(0, createdDays)),
      })
      .returning({ id: s.userProjects.id });

    const attrs: [string, string][] = [];
    if (fx.stage) attrs.push(["status", fx.stage]);
    if (fx.maturity) attrs.push(["maturity", fx.maturity]);
    if (fx.nextStep) attrs.push(["next_step", fx.nextStep]);
    if (fx.deployIssue) attrs.push(["deployment_issue", fx.deployIssue]);
    if (fx.broken) attrs.push(["broken_features", fx.broken]);
    if (fx.security) attrs.push(["security_vulnerability", fx.security]);
    if (fx.stack) attrs.push(["stack", fx.stack]);
    if (liveUrl) attrs.push(["production_url", liveUrl]);
    for (const [key, value] of attrs) {
      await db.insert(s.attributes).values({
        userId,
        entityId: entity.id,
        key,
        value,
        source: key === "deployment_issue" ? "agent" : "ui",
        createdAt: ago(between(1, createdDays)),
        updatedAt: ago(between(0.5, Math.min(30, createdDays))),
      });
      count("attributes", 1);
    }

    if (liveUrl) {
      await db.insert(s.siteSnapshots).values({
        projectId: up.id,
        userId,
        requestedUrl: liveUrl,
        finalUrl: liveUrl,
        statusCode: fx.down ? 502 : 200,
        ok: !fx.down,
        responseMs: fx.down ? null : Math.round(between(120, 900)),
        title: fx.down ? null : fx.name,
        error: fx.down ? "502 Bad Gateway" : null,
        checkedAt: ago(between(0.01, 0.5)),
      });
      count("site_snapshots", 1);
    }

    projects.push({ fx, entityId: entity.id, upId: up.id, path, createdDays });
  }
  count("entities (project)", projects.length);
  count("user_projects", projects.length);
  const byName = (name: string) => {
    const p = projects.find((x) => x.fx.name === name);
    if (!p) throw new Error(`no project ${name}`);
    return p;
  };
  const connected = projects.filter((p) => p.path);

  // ── Runs: 60 days of history, failures included, three running now ──
  type RunRow = { id: string; project: Seeded; outcome: string | null; startedDays: number };
  const runs: RunRow[] = [];
  const insertRun = async (
    project: Seeded,
    startedDays: number,
    kind: "success" | "partial" | "error" | "running" | "timeout",
    opts: { intent?: string; adapter?: string; error?: string; prompt?: string } = {},
  ) => {
    const success = pick(RUN_SUCCESSES);
    const failure = pick(RUN_FAILURES);
    const adapter = opts.adapter ?? (kind === "error" ? failure.adapter : "claude");
    const error = opts.error ?? (kind === "error" ? failure.error : undefined);
    const durationDays = between(0.005, 0.04);
    const running = kind === "running";
    const outcome = running ? null : kind;
    const [row] = await db
      .insert(s.orchestrationRuns)
      .values({
        userId,
        projectId: project.entityId,
        adapter: adapter as "claude",
        intent: (opts.intent ?? pick(["next_best", "test_and_fix", "custom", "deploy_check"])) as
          "next_best" | "custom",
        state: running ? "running" : "closed",
        outcome: outcome as "success" | null,
        projectKey: project.fx.name,
        projectPath: project.path ?? `/srv/loki/projects/${project.fx.name}`,
        summary:
          kind === "success" || kind === "partial"
            ? {
                done: success.done,
                next: success.next,
                tests: kind === "success" ? "green — 128 passed" : "2 failing",
                todos: kind === "success" ? "0 open" : "2 open",
                health: kind === "success" ? "healthy" : "needs attention",
              }
            : null,
        payload: {
          projectKey: project.fx.name,
          projectPath: project.path ?? "",
          ...(error ? { error } : {}),
          ...(kind === "timeout" ? { note: "Closed by the reaper after 2 hours of silence." } : {}),
          ...(running
            ? {
                lastProgressAt: new Date(NOW - between(1, 4) * 60_000).toISOString(),
                lastStep: {
                  text: pick([
                    "Running the test suite",
                    "Editing src/app/page.tsx",
                    "Reading the feedback item and the page it points at",
                  ]),
                  at: new Date(NOW - between(1, 4) * 60_000).toISOString(),
                },
              }
            : {}),
        },
        startedAt: ago(startedDays),
        finishedAt: running ? null : ago(startedDays - durationDays),
        createdAt: ago(startedDays),
        tokensIn: running || kind === "error" ? null : Math.round(between(20_000, 400_000)),
        tokensOut: running || kind === "error" ? null : Math.round(between(2_000, 40_000)),
        costUsd: running || kind === "error" ? null : Number(between(0.2, 6).toFixed(2)),
      })
      .returning({ id: s.orchestrationRuns.id });

    await db.insert(s.promptHistory).values({
      userId,
      projectId: project.entityId,
      projectKey: project.fx.name,
      projectPath: project.path ?? "",
      adapter: adapter as "claude",
      intent: "custom",
      customPrompt:
        opts.prompt ??
        pick([
          "Next best step",
          "Fix the feedback items marked new, one commit each",
          "Check the live site at 390px and fix anything that overflows",
          "Deploy check — is main what is live?",
        ]),
      runId: row.id,
      dispatchedAt: ago(startedDays),
    });

    const events: [string, number][] = [
      ["task_started", startedDays],
      ...(running
        ? []
        : ([
            [kind === "success" ? "task_completed" : "task_failed", startedDays - durationDays],
          ] as [string, number][])),
    ];
    for (const [eventType, d] of events) {
      await db.insert(s.orchestrationEvents).values({
        userId,
        projectId: project.entityId,
        projectKey: project.fx.name,
        eventType: eventType as "task_started",
        source: "runner",
        adapter: adapter as "claude",
        detail: eventType === "task_failed" ? (error ?? "failed") : null,
        happenedAt: ago(d),
      });
      count("orchestration_events", 1);
    }

    const runEventKinds = running
      ? ["dispatched", "claimed", "launched", "submitted", "generating", "progress"]
      : kind === "error"
        ? ["dispatched", "claimed", "closed"]
        : ["dispatched", "claimed", "submitted", "generating", "handoff", "closed"];
    for (const [k, kindName] of runEventKinds.entries()) {
      await db.insert(s.runEvents).values({
        runId: row.id,
        userId,
        kind: kindName as "dispatched",
        detail: kindName === "closed" ? { outcome } : null,
        createdAt: new Date(ago(startedDays).getTime() + k * 40_000),
      });
      count("run_events", 1);
    }

    runs.push({ id: row.id, project, outcome, startedDays });
    count("orchestration_runs", 1);
    count("prompt_history", 1);
    return row.id;
  };

  for (let i = 0; i < 64; i++) {
    const project = pick(connected);
    const r = rand();
    const kind = r < 0.58 ? "success" : r < 0.72 ? "partial" : r < 0.93 ? "error" : "timeout";
    await insertRun(project, between(0.2, 59), kind);
  }
  // The exact failures the owner sees.
  await insertRun(byName("substrata"), 0.4, "error", {
    adapter: "claude",
    error: 'no running agent for "substrata" on this runner',
  });
  await insertRun(byName("orangecat-2"), 1.3, "error", {
    adapter: "grok",
    error: "Grok is not installed on the cloud builder, so nothing was started.",
  });
  for (const d of [0.8, 2.1, 3.4, 5.0]) {
    await insertRun(byName("Farmhouse"), d, "error", {
      intent: "deploy_check",
      error: "Preview build timed out after 15 minutes.",
    });
  }
  await insertRun(byName("aoz-housing"), 0.03, "running");
  await insertRun(byName("loki"), 0.06, "running");
  await insertRun(byName("camille-boulangerie"), 0.01, "running");

  await db.insert(s.runEscalations).values({
    userId,
    projectKey: "Farmhouse",
    level: "human",
    failStreak: 4,
    lastRunId: runs.filter((r) => r.project.fx.name === "Farmhouse").at(-1)?.id ?? null,
    lastOutcome: "error",
    lastError: "Preview build timed out after 15 minutes.",
    openedAt: ago(5),
    updatedAt: ago(0.8),
  });
  count("run_escalations", 1);

  // ── Live state per project (Home / Today / Sessions) ──
  const stateful = connected.slice(0, 14);
  for (const [i, p] of stateful.entries()) {
    const working = p.fx.name === "aoz-housing" || p.fx.name === "loki";
    const blocked = p.fx.name === "Farmhouse";
    const last = pick(RUN_SUCCESSES);
    await db.insert(s.projectStates).values({
      userId,
      projectKey: p.fx.name,
      projectId: p.entityId,
      tabName: p.fx.name,
      agentRunning: working,
      tabOpen: i < 8,
      activeAgents: working ? ["claude"] : [],
      sessionStatus: working ? "working" : blocked ? "blocked" : "ready",
      sessionBlockReason: blocked ? "awaiting_user" : null,
      autoContinueEnabled: !p.fx.paused,
      promptQueue: i % 4 === 0 ? ["Next best step", "Fix the oldest feedback item"] : [],
      sessionDone: last.done,
      sessionNext: blocked ? "Needs the client's Airbnb iCal link before it can go on." : last.next,
      sessionTests: "green",
      sessionTodos: `${i % 3} open`,
      sessionHealth: blocked ? "blocked" : "healthy",
      sessionCommit: token(4).slice(0, 7),
      sessionUpdatedAt: ago(between(0.01, 6)),
      currentPromptKey: working ? "custom" : null,
      currentPromptLabel: working ? "Fix the feedback items marked new" : null,
      currentPromptStartedAt: working ? ago(0.04) : null,
      runtimeObservedAt: ago(0.01),
      updatedAt: ago(between(0.01, 2)),
    });
    count("project_states", 1);
  }
  for (const [i, p] of stateful.slice(0, 6).entries()) {
    await db.insert(s.agentSessions).values({
      userId,
      sessionId: randomUUID(),
      projectKey: p.fx.name,
      cwd: p.path ?? "",
      projectId: p.entityId,
      agent: i === 3 ? "codex" : "claude",
      startedAt: ago(between(0.05, 3)),
      endedAt: i === 5 ? ago(0.02) : null,
    });
    count("agent_sessions", 1);
  }
  await db.insert(s.runtimeSnapshots).values([
    {
      userId,
      channel: "cloud",
      openTabs: stateful.slice(0, 8).map((p) => p.fx.name),
      installedAgents: ["claude", "codex"],
      runnerVersion: "2026.10.20",
      observedAt: ago(0.002),
    },
    {
      userId,
      channel: "local",
      openTabs: [],
      installedAgents: ["claude", "codex", "gemini"],
      runnerVersion: "2026.09.28",
      observedAt: ago(8),
    },
  ]);
  await db.insert(s.runnerPresence).values({
    userId,
    connectionCount: 1,
    connected: true,
    cloudConnectionCount: 1,
    cloudConnected: true,
    localConnectionCount: 0,
    localConnected: false,
    connectedAt: ago(0.4),
    lastChangeAt: ago(0.4),
  });
  count("runtime_snapshots", 2);
  count("runner_presence", 1);

  // ── Feedback: 73 on one project, 8 on another, a few elsewhere ──
  const feedbackRuns = runs.filter((r) => r.outcome !== null);
  for (const [name, n, kind] of FEEDBACK_PLAN) {
    const p = byName(name);
    const texts: readonly string[] = kind === "aoz" ? AOZ_FEEDBACK : SITE_FEEDBACK;
    const pages = kind === "aoz" ? AOZ_PAGES : SITE_PAGES;
    const ownRuns = feedbackRuns.filter((r) => r.project === p);
    const [widget] = await db
      .insert(s.widgetTokens)
      .values({
        projectId: p.entityId,
        userId,
        token: `lk_${token(16)}`,
        origins: [`https://${name}.orangecat.ch`],
        lastSeenAt: ago(0.2),
        lastSeenOrigin: `https://${name}.orangecat.ch`,
        createdAt: ago(p.createdDays),
      })
      .returning({ id: s.widgetTokens.id });
    count("widget_tokens", 1);
    for (let i = 0; i < n; i++) {
      const r = rand();
      const status = r < 0.62 ? "new" : r < 0.78 ? "dispatched" : r < 0.9 ? "resolved" : "archived";
      const page = pick(pages);
      const created = between(0.1, Math.min(58, p.createdDays));
      const run =
        status === "dispatched" || status === "resolved"
          ? pick(ownRuns.length ? ownRuns : feedbackRuns)
          : null;
      await db.insert(s.siteFeedback).values({
        projectId: p.entityId,
        userId,
        tokenId: widget.id,
        suggestion:
          rand() < 0.2
            ? `${pick(texts)}. ${pick(texts)}. Also: ${pick(texts).toLowerCase()} — happened twice today, once on my phone and once on the computer at the office.`
            : pick(texts),
        contact: rand() < 0.3 ? `${pick(["anna", "omar", "lea", "visitor"])}@example.org` : null,
        page,
        url: `https://${name}.orangecat.ch${page}`,
        pageTitle: name,
        scope: pick(["page", "element", "site"] as const),
        userAgent: pick([
          "Mozilla/5.0 (Linux; Android 9; SM-J530F) Chrome/118",
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129",
        ]),
        source: rand() < 0.8 ? "visitor" : pick(["ai_review", "owner"] as const),
        duplicateCount: rand() < 0.15 ? Math.round(between(2, 6)) : 1,
        status,
        archiveReason: status === "archived" ? "Duplicate of an earlier report." : null,
        dispatchedRunId: run?.id ?? null,
        resolvedAt: status === "resolved" ? ago(Math.max(0, created - 1)) : null,
        createdAt: ago(created),
      });
      count("site_feedback", 1);
    }
  }

  // ── Notifications (the bell) — stale ones included ──
  for (const [type, severity, title, description, days, actionUrl] of ALERTS) {
    await db
      .insert(s.alerts)
      .values({ userId, type, severity, title, description, actionUrl, createdAt: ago(days) });
    count("alerts", 1);
  }
  await db.insert(s.alerts).values({
    userId,
    type: "bill_due",
    severity: "info",
    title: "Hetzner invoice due",
    dismissed: true,
    dismissedAt: ago(10),
    createdAt: ago(12),
  });
  count("alerts", 1);

  // ── Prompts: four identical copies, two near-copies, the rest ──
  for (const pr of PROMPTS) {
    const projectId = pr.project ? byName(pr.project).entityId : null;
    const runCount = pr.runs ?? 0;
    await db.insert(s.prompts).values({
      userId,
      name: pr.name,
      description: pr.description ?? null,
      body: pr.body,
      scope: projectId ? "project" : "global",
      projectId,
      tags: pr.name.toLowerCase().includes("feedback") ? ["feedback"] : [],
      variables: [...pr.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => ({ name: m[1] })),
      runCount,
      successCount: Math.round(runCount * 0.8),
      createdAt: ago(pr.days),
      updatedAt: ago(pr.days / 2),
    });
    count("prompts", 1);
  }

  // ── Loki chat: a dozen threads of the 210 ──
  for (const [i, t] of THREADS.entries()) {
    const start = between(0.1, 50);
    const [conv] = await db
      .insert(s.conversations)
      .values({
        userId,
        title: t.title,
        projectKeys: t.keys,
        channel: t.channel ?? null,
        lastReadAt: i % 3 === 0 ? null : ago(start - 0.1),
        pinnedAt: i === 0 ? ago(3) : null,
        createdAt: ago(start + 2),
        updatedAt: ago(start),
      })
      .returning({ id: s.conversations.id });
    for (const [k, [role, content]] of t.msgs.entries()) {
      await db.insert(s.conversationMessages).values({
        conversationId: conv.id,
        role,
        kind: role === "assistant" ? "chat" : null,
        content,
        createdAt: new Date(ago(start + 2).getTime() + k * 90_000),
      });
      count("conversation_messages", 1);
    }
    count("conversations", 1);
  }

  // ── People, crew, the rest of memory ──
  const people: { id: string; name: string }[] = [];
  for (const [i, [name, desc, company, channel]] of PERSON_FIXTURES.entries()) {
    const [person] = await db
      .insert(s.entities)
      .values({
        userId,
        name,
        type: "person",
        description: desc,
        source: "showcase-seed",
        createdAt: ago(between(20, 60)),
      })
      .returning({ id: s.entities.id });
    people.push({ id: person.id, name });
    const attrs: [string, string][] = [
      ["relationship", i < 10 ? "client" : pick(["friend", "colleague", "contractor"])],
      [
        `channel:${channel}`,
        channel === "email"
          ? `${name.split(" ")[0].toLowerCase()}@example.org`
          : "+41 79 000 00 00",
      ],
    ];
    if (company) attrs.push(["company", company]);
    if (i >= 4 && i <= 7) {
      attrs.push(
        [CREW_ATTR.MEMBER, "true"],
        [CREW_ATTR.ROLE, desc],
        [
          CREW_ATTR.SKILLS,
          pick([
            "design, Figma",
            "React, accessibility",
            "testing, screen readers",
            "photos, video",
          ]),
        ],
        [CREW_ATTR.ENGAGEMENT, pick(["freelance", "contract", "favor"])],
        [CREW_ATTR.RATE, "90"],
        [CREW_ATTR.CURRENCY, "CHF"],
      );
    }
    for (const [key, value] of attrs) {
      await db
        .insert(s.attributes)
        .values({ userId, entityId: person.id, key, value, source: "ui" });
      count("attributes", 1);
    }
    const touches = i % 5 === 4 ? 0 : Math.round(between(1, 6));
    for (let k = 0; k < touches; k++) {
      await db.insert(s.interactions).values({
        userId,
        entityId: person.id,
        channel,
        direction: rand() < 0.5 ? "inbound" : "outbound",
        summary: pick([
          "Sent the preview link",
          "Asked for the opening hours",
          "Call about the invoice",
          "Feedback on the gallery",
          "Coffee, talked about the next project",
        ]),
        // Later people in the book were last heard from longer ago: fading, then stale.
        occurredAt: ago(between(0.5 + i * 2, 8 + i * 2)),
      });
      count("interactions", 1);
    }
  }
  count("entities (person)", people.length);
  for (const [i, p] of people.slice(0, 10).entries()) {
    const project = projects[i * 3 + 1] ?? projects[0];
    await db.insert(s.entityRelations).values({
      userId,
      fromEntityId: p.id,
      toEntityId: project.entityId,
      type: "client_of",
    });
    count("entity_relations", 1);
  }
  for (const [name, type, desc] of [
    ["AOZ", "company", "Asylum Organisation Zurich — client"],
    ["Hetzner", "company", "Hosting"],
    ["Twint", "tool", "Swiss mobile payments"],
    ["Claude Code", "tool", "Agent CLI on the builders"],
    ["Accessibility first", "concept", "Every client site passes a screen reader check"],
    ["Pseudonymous by default", "concept", "OrangeCat principle"],
  ] as const) {
    await db
      .insert(s.entities)
      .values({ userId, name, type, description: desc, source: "showcase-seed" });
    count(`entities (${type})`, 1);
  }
  const robots = await ensureDefaultVacuums(userId);
  count("entities (robot)", robots.length);

  // Crew assignments in every state.
  const crew = people.slice(4, 8);
  for (const [i, [title, status, project, days]] of CREW_TASKS.entries()) {
    const shared = status !== "draft";
    const [task] = await db
      .insert(s.humanTasks)
      .values({
        userId,
        assigneeId: crew[i % crew.length].id,
        projectId: byName(project).entityId,
        title,
        brief: `${title}. Send what you have by the due date, even if unfinished.`,
        reason: "The client asked for it and an agent cannot do it.",
        status: status as "draft",
        dueDate: ago(days - 10),
        feeAmount: i % 2 === 0 ? 180 : null,
        feeCurrency: i % 2 === 0 ? "CHF" : null,
        shareToken: shared ? token(24) : null,
        sharedAt: shared ? ago(days - 0.5) : null,
        viewedAt: shared ? ago(days - 1) : null,
        assignedAt: shared ? ago(days - 0.5) : null,
        respondedAt: ["accepted", "declined", "delivered", "done"].includes(status)
          ? ago(days - 2)
          : null,
        deliveredAt: ["delivered", "done"].includes(status) ? ago(days - 6) : null,
        completedAt: status === "done" ? ago(days - 8) : null,
        createdAt: ago(days),
      })
      .returning({ id: s.humanTasks.id });
    type Step = [kind: string, actor: string, status: string | null, note: string | null];
    const reached = (...xs: string[]) => xs.includes(status);
    const timeline: Step[] = [["created", "operator", "draft", null]];
    if (shared) timeline.push(["shared", "operator", "assigned", null]);
    if (reached("declined"))
      timeline.push(["status", "assignee", "declined", "No time this month."]);
    if (reached("accepted", "delivered", "done"))
      timeline.push(["status", "assignee", "accepted", "On it."]);
    if (reached("delivered", "done"))
      timeline.push(["status", "assignee", "delivered", "Uploaded to the shared folder."]);
    if (reached("done")) timeline.push(["status", "operator", "done", null]);
    for (const [k, [kind, actor, st, note]] of timeline.entries()) {
      await db.insert(s.humanTaskEvents).values({
        taskId: task.id,
        userId,
        kind: kind as "created",
        actor: actor as "operator",
        status: st as "draft" | null,
        note,
        createdAt: ago(days - k * 1.5),
      });
      count("human_task_events", 1);
    }
    count("human_tasks", 1);
  }

  // ── Approvals waiting ──
  for (const [type, status, title, description, days] of ACTIONS) {
    await db.insert(s.actions).values({
      userId,
      type: type as "send_message",
      status: status as "draft",
      title,
      description,
      payload:
        type === "send_message"
          ? { to: title.split(" ")[1] ?? "", channel: "whatsapp", body: description }
          : type === "create_event"
            ? { eventTitle: title, eventStart: ago(-2).toISOString(), allDay: false }
            : { body: description },
      reasoning: "Seen in the last week's activity.",
      createdAt: ago(days),
      reviewedAt: status === "draft" ? null : ago(days - 0.5),
      executedAt: status === "executed" ? ago(days - 0.5) : null,
    });
    count("actions", 1);
  }

  // ── Packages: who is on what, updates held for a decision ──
  for (const p of connected.slice(0, 22)) {
    for (const [name, versions] of Object.entries(PACKAGE_VERSIONS)) {
      if (rand() < 0.45) continue;
      const version = pick(versions);
      await db.insert(s.projectPackages).values({
        userId,
        projectId: p.upId,
        packageName: name,
        spec: `github:bitbaum/${name.split("/")[1]}#v${version}`,
        version,
        source: "git",
        observedAt: ago(between(0.1, 3)),
        commitSha: token(20),
      });
      count("project_packages", 1);
    }
    await db.insert(s.projectPackageScans).values({
      projectId: p.upId,
      userId,
      commitSha: token(20),
      outcome: p.fx.name === "datacat-web" ? "unreachable" : "ok",
      scannedAt: ago(between(0.1, 1)),
    });
    count("project_package_scans", 1);
  }
  for (const [project, pr, pkg, from, to, ci, breaking] of [
    ["aoz-housing", 214, "@bitbaum/chatkit", "0.8.2", "0.9.0", "green", true],
    ["orangecat", 1840, "@bitbaum/design-tokens", "2.0.3", "2.1.0", "red", false],
    ["aoz-housing", 216, "next", "16.0.3", "16.1.0", "pending", false],
  ] as const) {
    const p = byName(project);
    await db.insert(s.packageUpdateRequests).values({
      userId,
      projectId: p.upId,
      prNumber: pr,
      prUrl: `https://github.com/bitbaum/${project}/pull/${pr}`,
      title: `chore(deps): bump ${pkg} from ${from} to ${to}`,
      packages: [{ name: pkg, dependency: pkg, from, to, breaking, fleet: pkg.startsWith("@") }],
      ciState: ci,
      state: "held",
      heldByLoki: true,
      openedAt: ago(between(1, 6)),
    });
    count("package_update_requests", 1);
  }

  // ── Scheduled jobs ──
  for (const [i, [name, expr, message, enabled, lastError]] of SCHEDULED_JOBS.entries()) {
    const id = randomUUID();
    await db.insert(s.cronJobs).values({
      userId,
      enabled,
      createdAt: ago(50 - i * 5),
      job: {
        id,
        agentId: "loki",
        name,
        enabled,
        schedule: { kind: "cron", expr, tz: "Europe/Zurich" },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message, timeoutSeconds: 600, thinking: "low", model: "" },
        delivery: { mode: "announce", channel: "telegram", to: "", bestEffort: true },
        state: {
          lastRunAtMs: NOW - between(0.2, 6) * DAY,
          lastStatus: lastError ? "error" : "ok",
          consecutiveErrors: lastError ? 3 : 0,
          lastError: lastError ?? undefined,
          nextRunAtMs: NOW + between(0.1, 3) * DAY,
        },
        createdAtMs: NOW - (50 - i * 5) * DAY,
        updatedAtMs: NOW - DAY,
      },
    });
    count("cron_jobs", 1);
  }

  // ── Goals with milestones, habits with history ──
  const goalIds: string[] = [];
  for (const g of GOALS) {
    const [goal] = await db
      .insert(s.goals)
      .values({
        userId,
        entityId: g.project ? byName(g.project).entityId : null,
        parentGoalId: g.parent !== undefined ? goalIds[g.parent] : null,
        title: g.title,
        status: g.status ?? "active",
        progress: g.progress,
        targetDate: ago(g.target),
        completedAt: g.status === "completed" ? ago(20) : null,
        milestones: g.milestones.map(([title, done], k) => ({
          title,
          done,
          date: done ? isoDate(ago(40 - k * 8)) : undefined,
        })),
        createdAt: ago(55),
      })
      .returning({ id: s.goals.id });
    goalIds.push(goal.id);
    count("goals", 1);
  }

  for (const [i, [title, frequency, rate, goalIdx]] of HABITS.entries()) {
    const [habit] = await db
      .insert(s.habits)
      .values({ userId, title, frequency, sortOrder: i, createdAt: ago(60) })
      .returning({ id: s.habits.id });
    count("habits", 1);
    for (let d = 0; d < 60; d++) {
      const day = ago(d);
      const dow = day.getUTCDay();
      if (frequency === "weekdays" && (dow === 0 || dow === 6)) continue;
      if (frequency === "weekly" && dow !== 6) continue;
      if (rand() > rate) continue;
      await db
        .insert(s.habitCompletions)
        .values({ userId, habitId: habit.id, completedDate: isoDate(day) });
      count("habit_completions", 1);
    }
    if (goalIdx !== null) {
      await db.insert(s.habitGoals).values({ userId, habitId: habit.id, goalId: goalIds[goalIdx] });
      count("habit_goals", 1);
    }
  }

  // ── Today: commitments, captures, subscriptions, events ──
  for (const [desc, dueIn, money, project] of COMMITMENTS) {
    await db.insert(s.commitments).values({
      userId,
      entityId: project ? byName(project).entityId : null,
      description: desc,
      dueDate: ago(dueIn),
      financialImpact: money,
      source: "loki",
      createdAt: ago(Math.max(dueIn, 0) + 5),
    });
    count("commitments", 1);
  }
  for (const [body, days] of [
    ["milk, bread flour", 0.2],
    ["ask Anna if the case workers can test on Friday", 1],
    ["idea: one page per tram stop for aoz-housing?", 4],
    ["call the dentist back", 9],
  ] as const) {
    await db.insert(s.captures).values({ userId, body, createdAt: ago(days) });
    count("captures", 1);
  }
  for (const [name, vendor, amount, currency, frequency, category, dueIn] of SUBSCRIPTIONS) {
    await db.insert(s.subscriptions).values({
      userId,
      name,
      vendor,
      amount,
      currency: currency as "CHF",
      frequency: frequency as "monthly",
      category,
      status: name === "Old VPS" ? "unverified" : "active",
      nextDue: ago(-dueIn),
      paymentMethod: pick(["Visa", "Twint", "Bank transfer"]),
      createdAt: ago(58),
    });
    count("subscriptions", 1);
  }
  for (const [name, type, days, location, status] of EVENTS) {
    await db.insert(s.events).values({
      userId,
      name,
      type,
      location,
      dateStart: ago(days),
      dateEnd: ago(days - 0.3),
      deadline: type === "grant" ? ago(days) : null,
      status,
      url: `https://example.org/${name.toLowerCase().replace(/\W+/g, "-")}`,
      createdAt: ago(40),
    });
    count("events", 1);
  }

  // ── Autopilot nights, suggestion decisions ──
  const aoz = byName("aoz-housing");
  for (const [d, started] of [
    [1, true],
    [2, false],
    [4, true],
  ] as const) {
    await db.insert(s.autopilotNights).values({
      userId,
      night: isoDate(ago(d)),
      summary: {
        budget: 3,
        fixes: started
          ? [{ feedbackId: randomUUID(), projectName: aoz.fx.name, runId: runs[0].id }]
          : [
              {
                feedbackId: randomUUID(),
                projectName: aoz.fx.name,
                runId: null,
                why: "Grok is not installed on the cloud builder, so nothing was started.",
              },
            ],
        reads: [{ projectName: "camille-boulangerie", runId: started ? runs[1].id : null }],
        archived: started ? 4 : 0,
        rerouted: 0,
        skipped: { paused: 5, busy: 1, not_runnable: 9, lane_taken: 0, over_budget: 2 },
      },
      createdAt: ago(d - 0.3),
    });
    count("autopilot_nights", 1);
  }
  await db.insert(s.suggestionDecisions).values([
    {
      userId,
      suggestionId: "build:petvity:start",
      decision: "dismissed",
      label: "Start petvity",
      createdAt: ago(6),
    },
    {
      userId,
      suggestionId: "money:old-vps",
      decision: "taken",
      label: "Cancel the old VPS",
      createdAt: ago(3),
    },
  ]);
  count("suggestion_decisions", 2);

  return { userId, removedTotal, counts };
}

main()
  .then(({ userId, removedTotal, counts }) => {
    console.log(
      removedTotal > 0
        ? `replaced the previous showcase account (${removedTotal} rows removed)`
        : "no previous showcase account",
    );
    console.log(`\nseeded ${SHOWCASE_EMAIL} (${userId}):`);
    for (const [table, n] of Object.entries(counts).sort()) console.log(`  ${table}: ${n}`);
    console.log(`\nSign in at /sign-in: ${SHOWCASE_EMAIL} / ${SHOWCASE_PASSWORD}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
