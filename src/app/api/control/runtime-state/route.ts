import { NextRequest, NextResponse } from "next/server";
import {
  getProjectState,
  getProjectStatesByUserId,
  persistProjectRuntimeIfNewer,
  persistProjectSessionIfNewer,
} from "@/db/queries/project-states";
import { recordSessionHandoffChangelog } from "@/db/queries/user-projects";
import { upsertRuntimeSnapshotIfNewer } from "@/db/queries/runtime-snapshots";
import type { PaneRecord } from "@/db/schema/runtime-snapshots";
import { getApiUserId } from "@/lib/session";
import { isRuntimeAvailable } from "@/lib/runtime";
import { emitStateChanged } from "@/lib/sse-bus";
import { writePromptQueueMirror } from "@/lib/prompt-queue-mirror";
import { isCloudRunnerVersion } from "@/lib/builder-presence";
import { closeOpenRunsForProject, closeOpenRunBySessionTab } from "@/lib/orchestration/close-sweep";
import { isDerivedRunTab } from "@/lib/run-tab";
import { SESSION_STATUS } from "@/lib/constants/statuses";

function sanitizePanes(raw: unknown[]): PaneRecord[] {
  const out: PaneRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const tab = typeof obj.tab === "string" ? obj.tab.trim() : "";
    if (!tab) continue;
    const paneIndex =
      typeof obj.paneIndex === "number" && Number.isFinite(obj.paneIndex)
        ? Math.max(0, Math.floor(obj.paneIndex))
        : 0;
    const rec: PaneRecord = { tab, paneIndex };
    if (typeof obj.agentCli === "string" && obj.agentCli.trim()) rec.agentCli = obj.agentCli.trim();
    if (typeof obj.cwd === "string" && obj.cwd.trim()) rec.cwd = obj.cwd.trim();
    if (typeof obj.sessionName === "string" && obj.sessionName.trim())
      rec.sessionName = obj.sessionName.trim();
    out.push(rec);
  }
  return out;
}

interface ProjectRuntimePatch {
  tab: string;
  workspaceId?: string;
  observedAt?: number;
  agentRunning: boolean;
  tabOpen: boolean;
  activeAgents: string[];
  currentPromptKey?: string | null;
  currentPromptLabel?: string | null;
  currentPromptStartedAt?: number | null; // epoch seconds
  readyAt?: number | null; // epoch seconds
  lockAt?: number | null; // epoch seconds
  closingAt?: number | null;
  closedAt?: number | null;
  sessionDone?: string;
  sessionStatus?: string;
  sessionNext?: string;
  sessionTests?: string;
  sessionTodos?: string;
  sessionHealth?: string;
  /** Typecheck / lint result and the resulting HEAD sha. The DoD judge is
   *  prompted to check all three; before 2026-08-06 no layer carried them. */
  sessionTsc?: string;
  sessionLint?: string;
  sessionCommit?: string;
  /** Structured loop-control fields. See ProjectRuntimePayload in
   *  desktop/src/main/pusher.ts and src/lib/orchestration/contract.ts. */
  sessionBlockReason?: string;
  sessionNoOpCount?: number;
  sessionUpdatedAt?: number | null; // epoch seconds (file mtime)
}

function tsOrNull(epochS: number | null | undefined): Date | null {
  return epochS != null ? new Date(epochS * 1000) : null;
}

// POST /api/control/runtime-state
// Bearer-authenticated (env token or ck_* agent token).
// Pushes local agent runtime state into the DB so the cloud control plane can read it.
//
// All rows are scoped to the authenticated user — the runner services one user at
// a time and may only mutate its own runtime state. Previous versions resolved
// ownership by global project-name lookup, which silently merged state across
// tenants when two users had a project with the same name.
export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    projects?: unknown;
    openTabs?: unknown;
    installedAgents?: unknown;
    observedAt?: unknown;
    panes?: unknown;
    runnerVersion?: unknown;
    powerSource?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const observedAt =
    typeof body.observedAt === "number" && Number.isFinite(body.observedAt)
      ? new Date(body.observedAt)
      : new Date();

  if (Array.isArray(body.openTabs)) {
    const openTabs = body.openTabs.filter(
      (tab): tab is string => typeof tab === "string" && tab.trim().length > 0,
    );
    const installedAgents = Array.isArray(body.installedAgents)
      ? body.installedAgents.filter(
          (agent): agent is string => typeof agent === "string" && agent.trim().length > 0,
        )
      : undefined;
    const panes = Array.isArray(body.panes) ? sanitizePanes(body.panes) : undefined;
    const runnerVersion = typeof body.runnerVersion === "string" ? body.runnerVersion : undefined;
    const channel = isCloudRunnerVersion(runnerVersion) ? "cloud" : "local";
    // Narrowed against the union, not trusted as a string: an unrecognised
    // value must land as UNKNOWN (absent), never be persisted and later read
    // back as if the runner had told us something.
    const powerSource =
      body.powerSource === "ac" || body.powerSource === "battery" ? body.powerSource : undefined;
    await upsertRuntimeSnapshotIfNewer({
      userId,
      channel,
      openTabs,
      observedAt,
      installedAgents,
      panes,
      runnerVersion,
      powerSource,
    }).catch((err) => console.error("[runtime-state] runtime snapshot write failed:", err));
  }

  if (body.projects === undefined) {
    emitStateChanged(userId);
    return NextResponse.json({ ok: true, count: 0 });
  }

  if (!Array.isArray(body.projects)) {
    return NextResponse.json({ error: "projects must be an array" }, { status: 400 });
  }

  const projects = body.projects as ProjectRuntimePatch[];

  await Promise.all(
    projects.map(async (p) => {
      // Parallel-run alias tab (phase 2 worktree-per-agent, "<project>~<runId8>"):
      // deliberately NOT persisted as a project_states row — it would render as a
      // ghost project card and its runtime facts (agentRunning/closedAt) would
      // clobber the base project's. The alias exists only to close its own run:
      // a READY handoff closes exactly the run whose payload.sessionTab matches,
      // using the pushed session fields directly.
      if (isDerivedRunTab(p.tab)) {
        if (p.sessionUpdatedAt != null && p.sessionStatus?.toLowerCase() === SESSION_STATUS.READY) {
          void closeOpenRunBySessionTab(userId, p.tab, {
            status: p.sessionStatus,
            done: p.sessionDone ?? "",
            next: p.sessionNext ?? "",
            tests: p.sessionTests ?? "",
            todos: p.sessionTodos ?? "",
            health: p.sessionHealth ?? "",
            ...(p.sessionTsc !== undefined && { tsc: p.sessionTsc }),
            ...(p.sessionLint !== undefined && { lint: p.sessionLint }),
            ...(p.sessionCommit !== undefined && { commit: p.sessionCommit }),
            ...(p.sessionBlockReason !== undefined && { blockReason: p.sessionBlockReason }),
            ...(p.sessionNoOpCount !== undefined && { noOpCount: p.sessionNoOpCount }),
            mtime: p.sessionUpdatedAt * 1000,
          }).catch((err) => console.error("[runtime-state] parallel run close failed:", err));
        }
        return;
      }
      const projectObservedAt =
        typeof p.observedAt === "number" && Number.isFinite(p.observedAt)
          ? new Date(p.observedAt)
          : observedAt;
      await persistProjectRuntimeIfNewer({
        projectKey: p.tab,
        userId,
        workspaceId:
          typeof p.workspaceId === "string" && p.workspaceId.trim()
            ? p.workspaceId.trim()
            : undefined,
        tabName: p.tab,
        runtimeObservedAt: projectObservedAt,
        agentRunning: p.agentRunning,
        tabOpen: p.tabOpen,
        activeAgents: p.activeAgents,
        currentPromptKey: p.currentPromptKey ?? null,
        currentPromptLabel: p.currentPromptLabel ?? null,
        currentPromptStartedAt: tsOrNull(p.currentPromptStartedAt),
        readyAt: tsOrNull(p.readyAt),
        lockAt: tsOrNull(p.lockAt),
        closingAt: tsOrNull(p.closingAt),
        closedAt: tsOrNull(p.closedAt),
      }).catch((err) => console.error("[runtime-state] runtime write failed:", err));

      // Session files are timestamped at their source. Do not allow a delayed
      // heartbeat to replace newer session content already received.
      if (p.sessionUpdatedAt != null) {
        // Previous handoff BEFORE the write — the changelog append below only
        // fires when the done text actually changed (heartbeats re-push the
        // same session every few minutes).
        const prev = await getProjectState(userId, p.tab).catch(() => null);
        const updated = await persistProjectSessionIfNewer({
          projectKey: p.tab,
          userId,
          workspaceId:
            typeof p.workspaceId === "string" && p.workspaceId.trim()
              ? p.workspaceId.trim()
              : undefined,
          tabName: p.tab,
          sessionUpdatedAt: new Date(p.sessionUpdatedAt * 1000),
          ...(p.sessionStatus !== undefined && { sessionStatus: p.sessionStatus }),
          ...(p.sessionDone !== undefined && { sessionDone: p.sessionDone }),
          ...(p.sessionNext !== undefined && { sessionNext: p.sessionNext }),
          ...(p.sessionTests !== undefined && { sessionTests: p.sessionTests }),
          ...(p.sessionTodos !== undefined && { sessionTodos: p.sessionTodos }),
          ...(p.sessionHealth !== undefined && { sessionHealth: p.sessionHealth }),
          ...(p.sessionTsc !== undefined && { sessionTsc: p.sessionTsc }),
          ...(p.sessionLint !== undefined && { sessionLint: p.sessionLint }),
          ...(p.sessionCommit !== undefined && { sessionCommit: p.sessionCommit }),
          ...(p.sessionBlockReason !== undefined && { sessionBlockReason: p.sessionBlockReason }),
          ...(p.sessionNoOpCount !== undefined && { sessionNoOpCount: p.sessionNoOpCount }),
        }).catch((err) => {
          console.error("[runtime-state] session write failed:", err);
          return null;
        });
        // Changelog + OrangeCat promote for a NEW handoff — this route is the
        // ONLY ingestion point for cloud-executed sessions; without this the
        // devLog (and the OC wall) only ever heard about laptop sessions.
        if (updated && prev) {
          await recordSessionHandoffChangelog(userId, {
            projectId: prev.projectId,
            tab: p.tab,
            dateMs: p.sessionUpdatedAt * 1000,
            previousDone: prev.sessionDone,
            done: p.sessionDone,
            next: p.sessionNext,
            tests: p.sessionTests,
            todos: p.sessionTodos,
            health: p.sessionHealth,
          }).catch((err) => console.error("[runtime-state] changelog append failed:", err));
        }
        // A READY handoff is the run's completion signal. Attempt the close on
        // every heartbeat, even when this exact handoff was already persisted:
        // the first close can be interrupted after persistence (deploy/restart,
        // transient judge failure), and `updated` is then false forever. The
        // close seam is deliberately idempotent and verifies delivery,
        // freshness, and finishedAt before changing anything.
        if (p.sessionStatus?.toLowerCase() === SESSION_STATUS.READY) {
          void closeOpenRunsForProject(userId, p.tab).catch((err) =>
            console.error("[runtime-state] run close from handoff failed:", err),
          );
        }
      }
    }),
  );

  emitStateChanged(userId);

  // Keep the local hook transport mirror warm independently of the UI.
  if (isRuntimeAvailable()) {
    try {
      const states = await getProjectStatesByUserId(userId);
      for (const s of states) {
        writePromptQueueMirror(s.projectKey, s.promptQueue);
      }
    } catch (err) {
      console.error("[runtime-state] queue mirror sync failed:", err);
    }
  }

  return NextResponse.json({ ok: true, count: projects.length });
}
