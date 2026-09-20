// Hosted ephemeral runner — Phase 0 worker loop.
//
// Wires the read-only analysis core (src/lib/hosted-runner/analyze.ts) to the
// real runner loop: register presence so projects aren't dark, drain the
// `hosted_analyze` queue, run the analysis on hosted compute, report the result
// to the command + the project dev log. No writes to repos, no local runner
// needed — the fleet does read-only work while the operator's laptop is off.
//
// Run:  DATABASE_URL=… GROQ_API_KEY=… npx tsx scripts/hosted-runner.ts          (loop)
//       …                                npx tsx scripts/hosted-runner.ts --once  (drain + exit)
//
// Phase 1 (sandboxed coding agent) replaces analyzeRepo with a containerized
// agent and adds the dispatch/inject command types. See
// docs/architecture/hosted-ephemeral-runner.md.

import { setRunnerConnected } from "@/db/queries/runner-presence";
import {
  claimNextPendingCommand,
  markCommandExecuted,
  type HostedAnalyzePayload,
  type HostedDispatchPayload,
  type HostedNewSitePayload,
} from "@/db/queries/pending-commands";
import {
  validateNewSiteRequest,
  runNewSite,
  siteFactoryEnabled,
} from "@/lib/hosted-runner/new-site";
import {
  runRetireSite,
  siteFactoryEnabled as retireFactoryEnabled,
  validateRetireSiteRequest,
} from "@/lib/hosted-runner/retire-site";
import { getProjectContext } from "@/db/queries/project-context";
import {
  getRecentProjectActivity,
  type RecentProjectActivity,
} from "@/db/queries/orchestration-events";
import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { getGithubToken } from "@/lib/github-token";
import { appendProjectDevLog } from "@/db/queries/user-projects";
import { hostedRunDevLogEntry, type HostedRunOutcome } from "@/lib/hosted-run-log";
import { createOrchestrationEvent } from "@/db/queries/orchestration-events";
import type { AdapterId, OrchestrationEventType } from "@/lib/orchestration";
import { analyzeRepo } from "@/lib/hosted-runner/analyze";
import { runHermesTask } from "@/lib/hosted-runner/run-hermes";
import { settleBackgroundWork } from "@/lib/orchestration/settle-background-work";
import {
  getOrchestrationRunById,
  stampRunDelivered,
  updateOrchestrationRun,
} from "@/db/queries/orchestration-runs";
import { ORCHESTRATION_OUTCOME } from "@/db/schema/orchestration-runs";
import { ORCH_STATE } from "@/lib/orchestration/contract";

// The real executor id for a hosted coding dispatch. Hermes is a legitimate
// agent id (ALL_ADAPTERS) but intentionally NOT in the dispatchable
// ORCHESTRATION_ADAPTER_IDS, so record it with a localized cast — the same
// pattern close-sweep already uses for adapter strings outside that set.
const HERMES_ADAPTER = "hermes" as AdapterId;

const POLL_MS = 5_000;
// Both hosted classes: read-only analysis (Groq, Phase 0) + write-class dispatch
// to a sandboxed coding agent (Hermes, Phase 1). Local-runner dispatch/inject
// commands are deliberately NOT claimed here.
const HOSTED_TYPES = ["hosted_analyze", "hosted_dispatch", "hosted_new_site", "hosted_retire_site"];

/** Compact "what was just done" block so Hermes doesn't repeat or collide with
 *  recent work. Consumer-side because it enriches EVERY hosted dispatch (auto-
 *  routed or intentional) at the single choke point, not per trigger. */
function renderRecentActivity(rows: RecentProjectActivity[]): string | null {
  if (!rows.length) return null;
  const now = Date.now();
  const ago = (d: Date) => {
    const mins = Math.max(1, Math.round((now - d.getTime()) / 60_000));
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
  };
  const lines = rows.map((r) => {
    const who = r.adapter ? `${r.adapter}: ` : "";
    const mark = r.eventType === "task_failed" ? "✗" : "✓";
    return `- ${ago(r.happenedAt)} ${mark} ${who}${(r.detail ?? "").slice(0, 160)}`;
  });
  return [
    "Recent activity on this project (newest first — already done, do NOT repeat or undo it):",
    ...lines,
  ].join("\n");
}

/**
 * Close the tracked run a hosted dispatch was pinned to.
 *
 * The runner PTY path closes its run from the agent's session handoff; there
 * is no PTY here, so the hosted runner is the closer. Going through
 * updateOrchestrationRun is what makes the close ordinary: the outcome turn
 * reaches the thread that asked, the ledger and escalation bookkeeping run,
 * and the PR is on the run as evidence rather than buried in a dev-log line.
 */
async function closeHostedRun(
  userId: string,
  runId: string,
  result:
    | { ok: true; summary: string; prUrl?: string; branch?: string; noChanges?: boolean }
    | { ok: false; error: string },
): Promise<void> {
  const run = await getOrchestrationRunById(userId, runId).catch(() => null);
  if (!run || run.finishedAt) return;
  const outcome = !result.ok
    ? ORCHESTRATION_OUTCOME.ERROR
    : result.prUrl || result.noChanges
      ? ORCHESTRATION_OUTCOME.SUCCESS
      : ORCHESTRATION_OUTCOME.PARTIAL;
  const evidence =
    result.ok && result.prUrl
      ? { kind: "pr", url: result.prUrl, title: "hosted runner pull request", atMs: Date.now() }
      : undefined;
  await updateOrchestrationRun(
    runId,
    {
      state: result.ok ? ORCH_STATE.DONE : ORCH_STATE.ERROR,
      outcome,
      finishedAt: new Date(),
      payload: {
        ...(run.payload ?? {}),
        ...(result.ok ? { resultText: result.summary } : { error: result.error }),
        ...(evidence ? { evidence } : {}),
      },
    },
    userId,
  ).catch((err) => console.error("[hosted-runner] run close failed:", err));
}

/**
 * One dev-log line per finished hosted run.
 *
 * The shape of that line is decided in src/lib/hosted-run-log.ts, not here:
 * the newest entry is what the project dossier re-serves to every later
 * dispatch as "Latest handoff", so what goes in it is a product decision with
 * a test behind it rather than a slice() at a call site (#584).
 */
async function logResult(
  userId: string,
  projectKey: string,
  task: string,
  outcome: HostedRunOutcome,
) {
  await appendProjectDevLog(userId, projectKey, hostedRunDevLogEntry(task, outcome)).catch((e) =>
    console.error("[hosted-runner] devlog append failed:", e),
  );
}

/** Emit a lifecycle event into orchestration_events — the SAME stream inject-core
 *  writes and Activity reads — so hosted (Hermes/analysis) runs are observable in
 *  the product instead of only in console logs. Fire-and-forget: telemetry must
 *  never fail the run. `adapter` records the true executor ("hermes" for a coding
 *  dispatch; null for read-only analysis). */
async function emitHostedEvent(
  userId: string,
  projectKey: string,
  eventType: OrchestrationEventType,
  detail: string,
  adapter?: AdapterId,
) {
  await createOrchestrationEvent({
    userId,
    projectKey,
    eventType,
    source: "hosted-runner",
    adapter: adapter ?? null,
    detail: detail.slice(0, 500),
    happenedAt: new Date(),
  }).catch((e) => console.error("[hosted-runner] event emit failed:", e));
}

/**
 * Provision a brand-new site from a validated payload.
 *
 * Deliberately its own function rather than a branch in the middle of tick():
 * it shares nothing with the other two. No repo to clone, no project context to
 * inject, no agent, no diff, no PR. It runs one audited script with an argument
 * vector and reports what it built.
 *
 * A rejected payload is marked EXECUTED with the reason, not left to retry.
 * Validation failures are deterministic — a slug that is reserved now is
 * reserved on every redelivery — so retrying is just a queue that never drains.
 */
/**
 * Take a site down — plan or execute, decided by the payload's `confirm`.
 *
 * The plan path is the reason this is a command rather than a direct call: it
 * runs the same script with the same arguments the real teardown would use and
 * returns exactly what it WOULD touch, so the confirmation a person sees is
 * produced by the code that acts, not by a second description of it that can
 * drift.
 */
async function tickRetireSite(userId: string, cmdId: string, payload: unknown): Promise<boolean> {
  const parsed = validateRetireSiteRequest(payload);
  if (!parsed.ok) {
    console.warn(`[hosted-runner] retire rejected: ${parsed.reason}`);
    await markCommandExecuted(cmdId, userId, { ok: false, text: `rejected: ${parsed.reason}` });
    return true;
  }
  const req = parsed.value;
  const confirm = (payload as { confirm?: unknown })?.confirm === true;

  if (!retireFactoryEnabled()) {
    const msg = "site factory disabled on this runner (set LOKI_SITE_FACTORY=1 to arm it)";
    console.warn(`[hosted-runner] ${msg}`);
    await markCommandExecuted(cmdId, userId, { ok: false, text: msg });
    return true;
  }

  const scriptPath = process.env.LOKI_RETIRE_SITE_SCRIPT;
  if (!scriptPath) {
    const msg = "LOKI_RETIRE_SITE_SCRIPT is not set; refusing to guess where retire-site.sh lives";
    console.warn(`[hosted-runner] ${msg}`);
    await markCommandExecuted(cmdId, userId, { ok: false, text: msg });
    return true;
  }

  console.log(
    `[hosted-runner] retire ${req.slug} (${req.mode}, repo ${req.repo}, confirm=${confirm})`,
  );
  const res = await runRetireSite(req, { scriptPath, confirm });
  await markCommandExecuted(
    cmdId,
    userId,
    res.ok
      ? { ok: true, text: res.output.slice(-4000) }
      : { ok: false, text: res.error.slice(0, 4000) },
  );
  return true;
}

async function tickNewSite(userId: string, cmdId: string, payload: unknown): Promise<boolean> {
  const parsed = validateNewSiteRequest(payload as HostedNewSitePayload);
  if (!parsed.ok) {
    console.warn(`[hosted-runner] new-site rejected: ${parsed.reason}`);
    await markCommandExecuted(cmdId, userId, { ok: false, text: `rejected: ${parsed.reason}` });
    return true;
  }
  const req = parsed.value;

  if (!siteFactoryEnabled()) {
    // Not an error in the payload — this runner simply is not the one allowed
    // to create sites. Say which switch, so the answer is not a guess.
    const msg = "site factory disabled on this runner (set LOKI_SITE_FACTORY=1 to arm it)";
    console.warn(`[hosted-runner] ${msg}`);
    await markCommandExecuted(cmdId, userId, { ok: false, text: msg });
    return true;
  }

  const scriptPath = process.env.LOKI_NEW_SITE_SCRIPT;
  if (!scriptPath) {
    const msg = "LOKI_NEW_SITE_SCRIPT is not set; refusing to guess where new-site.sh lives";
    console.warn(`[hosted-runner] ${msg}`);
    await markCommandExecuted(cmdId, userId, { ok: false, text: msg });
    return true;
  }

  console.log(`[hosted-runner] new-site ${req.slug} (${req.kind}/${req.status})`);
  const res = await runNewSite(req, {
    scriptPath,
    baseDomain: process.env.SITES_BASE_DOMAIN ?? "orangecat.ch",
    owner: process.env.GH_OWNER ?? "bitbaum",
  });

  if (res.ok) {
    await markCommandExecuted(cmdId, userId, {
      ok: true,
      text: `Created ${req.title}\n\nhttps://${res.host}\n${res.repo}\n\n${res.output.slice(-4000)}`,
    });
  } else {
    await markCommandExecuted(cmdId, userId, { ok: false, text: res.error.slice(0, 4000) });
  }
  return true;
}

/** Claim + execute one hosted command (analyze, dispatch, or new site). False when queue empty. */
async function tick(userId: string): Promise<boolean> {
  const cmd = await claimNextPendingCommand([userId], HOSTED_TYPES);
  if (!cmd) return false;

  // Site creation is handled BEFORE the project-context lookup below: it has no
  // project to look up. hosted_analyze and hosted_dispatch both operate on a
  // repo that already exists and key off `projectKey`/`gitUrl`; this one is the
  // command that brings those into being, so it carries neither.
  if (cmd.type === "hosted_new_site") {
    return await tickNewSite(userId, cmd.id, cmd.payload);
  }

  // Taking a site down carries no projectKey either: the slug IS the address,
  // and by the time this runs the Loki project may already be gone.
  if (cmd.type === "hosted_retire_site") {
    return await tickRetireSite(userId, cmd.id, cmd.payload);
  }

  const p = cmd.payload as HostedAnalyzePayload | HostedDispatchPayload;
  const [ctx, dbToken] = await Promise.all([
    getProjectContext(userId, p.projectKey).catch(() => null),
    getGithubToken(userId).catch(() => null),
  ]);
  // The owner's linked-OAuth token (DB) is preferred; on a hosted box where no
  // GitHub account is linked, fall back to GITHUB_TOKEN (provided by `gh auth
  // login` on the box → `gh auth token`). Without either, Hermes still runs but
  // can't push/PR — run-hermes surfaces that as an error, not silent data loss.
  const token = dbToken ?? process.env.GITHUB_TOKEN ?? null;
  try {
    if (cmd.type === "hosted_dispatch") {
      // Phase 1: write-class task → Hermes in its own sandbox (orchestrate, not out-build).
      console.log(`[hosted-runner] dispatch→hermes ${p.projectKey}: ${p.task.slice(0, 60)}`);
      if (p.runId) void stampRunDelivered(p.runId, userId);
      void emitHostedEvent(
        userId,
        p.projectKey,
        "task_started",
        `Hermes dispatch — ${p.task.slice(0, 120)}`,
        HERMES_ADAPTER,
      );
      const model = (cmd.payload as HostedDispatchPayload).model;
      // Recent-activity context: give Hermes the "what was just done" signal so it
      // doesn't repeat or undo recent work. Single choke point — every hosted
      // dispatch (auto-routed or intentional) gets it here, not per trigger.
      const recent = await getRecentProjectActivity(userId, p.projectKey).catch(() => []);
      const res = await runHermesTask({
        gitUrl: p.gitUrl,
        task: p.task,
        projectContext: ctx,
        recentActivity: renderRecentActivity(recent),
        token,
        model,
      });
      if (res.ok) {
        const summary = res.noChanges
          ? `${res.output}\n\n(Hermes made no file changes.)`
          : `${res.output}\n\n— changed:\n${res.diff || "(no diff)"}${res.prUrl ? `\n\nPR: ${res.prUrl}` : res.branch ? `\n\nPushed branch: ${res.branch}` : ""}`;
        await markCommandExecuted(cmd.id, userId, { ok: true, text: summary });
        if (p.runId) {
          await closeHostedRun(userId, p.runId, {
            ok: true,
            summary,
            prUrl: res.prUrl,
            branch: res.branch,
            noChanges: res.noChanges,
          });
        }
        await logResult(userId, p.projectKey, p.task, {
          ok: true,
          kind: "dispatch",
          prUrl: res.prUrl,
          branch: res.branch,
          noChanges: res.noChanges,
        });
        void emitHostedEvent(
          userId,
          p.projectKey,
          "task_completed",
          res.prUrl
            ? `Hermes → PR ${res.prUrl}`
            : res.noChanges
              ? "Hermes: no file changes"
              : `Hermes pushed ${res.branch ?? "a branch"}`,
          HERMES_ADAPTER,
        );
        console.log(
          `[hosted-runner] ✓ ${p.projectKey} (hermes/${res.model})${res.prUrl ? ` → ${res.prUrl}` : ""}`,
        );
      } else {
        await markCommandExecuted(cmd.id, userId, { ok: false, error: res.error });
        if (p.runId) await closeHostedRun(userId, p.runId, { ok: false, error: res.error });
        // Failures used to vanish into console only — log + emit so a broken hosted
        // path is visible in the project dev log and Activity, not archaeology.
        await logResult(userId, p.projectKey, p.task, {
          ok: false,
          kind: "dispatch",
          error: res.error,
        });
        void emitHostedEvent(
          userId,
          p.projectKey,
          "task_failed",
          `Hermes failed — ${res.error}`,
          HERMES_ADAPTER,
        );
        console.log(`[hosted-runner] ✗ ${p.projectKey}: ${res.error}`);
      }
    } else {
      // Phase 0: read-only analysis via Groq.
      console.log(`[hosted-runner] analyze ${p.projectKey}: ${p.task.slice(0, 60)}`);
      void emitHostedEvent(
        userId,
        p.projectKey,
        "task_started",
        `Hosted analysis — ${p.task.slice(0, 120)}`,
      );
      const res = await analyzeRepo({ gitUrl: p.gitUrl, task: p.task, projectContext: ctx, token });
      if (res.ok) {
        await markCommandExecuted(cmd.id, userId, { ok: true, text: res.report });
        await logResult(userId, p.projectKey, p.task, { ok: true, kind: "analysis" });
        void emitHostedEvent(
          userId,
          p.projectKey,
          "task_completed",
          `Hosted analysis complete (${res.model})`,
        );
        console.log(`[hosted-runner] ✓ ${p.projectKey} (${res.model})`);
      } else {
        await markCommandExecuted(cmd.id, userId, { ok: false, error: res.error });
        await logResult(userId, p.projectKey, p.task, {
          ok: false,
          kind: "analysis",
          error: res.error,
        });
        void emitHostedEvent(
          userId,
          p.projectKey,
          "task_failed",
          `Hosted analysis failed — ${res.error}`,
        );
        console.log(`[hosted-runner] ✗ ${p.projectKey}: ${res.error}`);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "hosted run failed";
    await markCommandExecuted(cmd.id, userId, { ok: false, error: msg });
    void emitHostedEvent(
      userId,
      p.projectKey,
      "task_failed",
      `Hosted run threw — ${msg}`,
      cmd.type === "hosted_dispatch" ? HERMES_ADAPTER : undefined,
    );
  }
  return true;
}

async function drain(userId: string): Promise<number> {
  let n = 0;
  while (await tick(userId)) n++;
  return n;
}

async function main() {
  const once = process.argv.includes("--once");
  // Phase 0 serves the Loki product owner's projects. Multi-tenant
  // scheduling across users is Phase 3.
  const target = await getSelfImprovementTarget();
  if (!target) {
    console.error("[hosted-runner] no loki owner resolved — nothing to serve");
    process.exit(1);
  }
  const userId = target.userId;

  // --once is a one-shot drain (e.g. a cron tick): do the work, do NOT claim a
  // persistent "online" presence the loop would own. Only the long-running loop
  // represents a continuously-available runner.
  if (once) {
    const n = await drain(userId);
    // Let fire-and-forget work finish before the process dies — see
    // settle-background-work.ts. Skipped when nothing was drained: an idle
    // tick has no background work to wait for.
    if (n > 0) await settleBackgroundWork();
    console.log(`[hosted-runner] drained ${n} (one-shot; presence unchanged)`);
    process.exit(0);
  }

  await setRunnerConnected(userId, true);
  console.log(
    `[hosted-runner] presence ON for ${userId}; polling hosted_analyze every ${POLL_MS}ms`,
  );
  const shutdown = async () => {
    await setRunnerConnected(userId, false).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  for (;;) {
    try {
      await drain(userId);
    } catch (e) {
      console.error("[hosted-runner] loop error:", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
