"use client";

import { useState } from "react";
import Link from "next/link";
import { GitBranch, ChevronDown, Loader2, SquareTerminal, UploadCloud, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/api/fetch";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import type { ProjectState } from "@/lib/control-types";
import { formatAgentRuntimeLabel } from "./control-presenter";
import { AgentSwitcherPopover } from "./agent-switcher-popover";
import type { AgentEntry } from "./agent-switcher-popover";
import { agentLabel, hasAgentLabelMismatch, resolveDisplayedAgentId } from "@/lib/agent-resolution";
import { deriveLoopState } from "@/lib/session-state";
import { deriveProjectLoopReadiness } from "@/lib/project-loop-readiness";
import { TOAST_MEDIUM_MS, TOAST_LONG_MS } from "@/lib/constants/timings";

/** Below this count, a no-op turn could be coincidence (queue drained between
 *  user turns). At or above, it's a pattern worth surfacing. The autopilot-
 *  needs-fire bash guard catches even count=1 to stop the spiral; this UI
 *  threshold is purely about how loudly to display it. */
const LOOP_NO_OP_DISPLAY_THRESHOLD = 2;

function statusChipClass(tone: "neutral" | "positive" | "warning" = "neutral", clickable = false) {
  return cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none transition-colors",
    // The tap floor belongs to chips you can actually tap. A read-only status
    // chip is a label, and inflating it to 44px just spaces the row out.
    clickable && "ui-tap",
    tone === "positive"
      ? "border-status-positive/25 bg-status-positive/[0.08] text-status-positive"
      : tone === "warning"
        ? "border-status-warning/30 bg-status-warning/[0.08] text-status-warning"
        : "border-border-subtle bg-surface-raised text-text-tertiary",
    clickable && "hover:border-border-default hover:bg-surface-overlay hover:text-text-secondary",
  );
}

function pendingChangesLabel(project: ProjectState): string | null {
  const dirtyCount = project.git?.dirtyCount ?? 0;
  if (!project.git?.dirty) return null;
  if (dirtyCount <= 0) return "Changes pending";
  return `${dirtyCount} pending change${dirtyCount === 1 ? "" : "s"}`;
}

export function ProjectStatusChips({
  project,
  tabOpen,
  compact = false,
  clickableWorkspace = true,
  availableAgents,
  localAgentId,
  switchingAgent = false,
  onSwitchAgent,
  isAgentWorking,
  runtimeStateKnown = true,
  autoContinueEnabled = true,
}: {
  project: ProjectState;
  tabOpen: boolean;
  compact?: boolean;
  clickableWorkspace?: boolean;
  availableAgents?: AgentEntry[];
  localAgentId?: string | null;
  switchingAgent?: boolean;
  onSwitchAgent?: (agentId: string | null) => void;
  /** Derived from getProjectDisplayState — SSOT for "working" badge/chip. When
   *  omitted, falls back to raw currentPrompt for backward-compat. */
  isAgentWorking?: boolean;
  runtimeStateKnown?: boolean;
  /** When false, show a clear "Auto paused" indicator so per-project pause is obvious. */
  autoContinueEnabled?: boolean;
}) {
  // SSOT for chip tone + label. When the parent passes the derived flag, we use
  // it (so staleness gating in getProjectDisplayState propagates to the chip);
  // otherwise fall back to the raw signal.
  const working = isAgentWorking ?? Boolean(project.currentPrompt);
  const [gitHelpOpen, setGitHelpOpen] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [commitState, setCommitState] = useState<"idle" | "committing" | "done" | "error">("idle");
  const [commitResult, setCommitResult] = useState<{ sha?: string; error?: string } | null>(null);
  const runtimeLabel = runtimeStateKnown ? formatAgentRuntimeLabel(project, project.liveTab) : "";
  const runtimeStateLabel = working ? `${runtimeLabel} working` : runtimeLabel;
  const git = project.git;
  const changesLabel = pendingChangesLabel(project);
  const dirtyHelp = git?.dirty
    ? `Pending changes means files were edited in this project but are not saved into Git history yet. Branch: ${git.branch}. In Git, a commit is the checkpoint that records those changes.`
    : `Branch: ${git?.branch}. No local file changes detected.`;

  const effectiveAgentId =
    resolveDisplayedAgentId(project, localAgentId, project.liveTab) ||
    localAgentId ||
    project.agentPref ||
    (availableAgents?.[0]?.id ?? "");
  const labelMismatch = hasAgentLabelMismatch(project, localAgentId, project.liveTab);
  const canSwitchAgent = onSwitchAgent && availableAgents && availableAgents.length > 1;

  // Loop state lives on a separate axis from per-turn agent state. An agent
  // can be `ready` (current chip says "ready") while the autopilot loop is
  // about to re-fire it for the 22nd no-op turn — invisible without this.
  // See src/lib/session-state.ts and the OC 2026-06-08 incident analysis.
  const loop = deriveLoopState(project.session);
  const readiness = deriveProjectLoopReadiness(project, autoContinueEnabled ? "on" : "off");
  const showAwaitingUser = loop.awaitingUser;
  const showLoopSpiral =
    !showAwaitingUser &&
    loop.state === "firing" &&
    (loop.noOpCount ?? 0) >= LOOP_NO_OP_DISPLAY_THRESHOLD;

  const quickCommit = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!project.dir || commitState === "committing") return;
    setCommitState("committing");
    setCommitResult(null);
    try {
      const res = await postJson("/api/project/commit", { dir: project.dir, push: true });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setCommitResult({ sha: body.sha });
        setCommitState("done");
        setTimeout(() => {
          setCommitState("idle");
          setCommitResult(null);
        }, TOAST_MEDIUM_MS);
      } else {
        setCommitResult({ error: body.error ?? "Commit failed" });
        setCommitState("error");
        setTimeout(() => {
          setCommitState("idle");
          setCommitResult(null);
        }, TOAST_LONG_MS);
      }
    } catch {
      setCommitState("error");
      setCommitResult({ error: "Network error" });
      setTimeout(() => {
        setCommitState("idle");
        setCommitResult(null);
      }, TOAST_MEDIUM_MS);
    }
  };

  // Open terminal must stay reachable even when nothing is running yet.
  // Returning null here hid the chip for not_running projects with no git
  // snapshot — the exact Control rows where operators most need a path into
  // `/terminal?project=…`. The terminal handles session setup when needed.
  if (!runtimeLabel && !git && !tabOpen && !clickableWorkspace) return null;

  const chips = (
    <div
      className={
        compact
          ? "flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-tertiary"
          : "ui-control-card-header-meta"
      }
    >
      {runtimeLabel &&
        (canSwitchAgent ? (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!switchingAgent) setAgentPopoverOpen((v) => !v);
              }}
              title={
                switchingAgent
                  ? "Switching agent…"
                  : labelMismatch
                    ? `Live: ${project.activeAgents.map(agentLabel).join(", ")} — preference: ${agentLabel(localAgentId ?? project.agentPref ?? "?")}. Click to switch.`
                    : `${runtimeLabel} — click to switch agent for this project`
              }
              disabled={switchingAgent}
              className={
                compact
                  ? cn(
                      "flex items-center gap-1 transition-colors hover:text-text-primary disabled:opacity-60",
                      labelMismatch ? "text-status-warning" : "text-text-secondary",
                    )
                  : cn(
                      statusChipClass(
                        switchingAgent
                          ? "neutral"
                          : working
                            ? "warning"
                            : labelMismatch
                              ? "warning"
                              : "neutral",
                        !switchingAgent,
                      ),
                      "cursor-pointer disabled:cursor-default disabled:opacity-70",
                      labelMismatch &&
                        !switchingAgent &&
                        "ring-1 ring-status-warning/50 animate-pulse",
                    )
              }
            >
              {switchingAgent ? (
                <>
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  <span>Switching…</span>
                </>
              ) : (
                <>
                  <span>{runtimeStateLabel}</span>
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 shrink-0 opacity-50 transition-transform",
                      agentPopoverOpen && "rotate-180",
                    )}
                  />
                </>
              )}
            </button>
            {agentPopoverOpen && (
              <AgentSwitcherPopover
                agents={availableAgents!}
                activeAgentId={effectiveAgentId}
                onSwitch={onSwitchAgent!}
                onClose={() => setAgentPopoverOpen(false)}
              />
            )}
          </div>
        ) : (
          <span
            className={cn(
              compact
                ? undefined
                : statusChipClass(working ? "warning" : labelMismatch ? "warning" : "neutral"),
              labelMismatch && !compact && "ring-1 ring-status-warning/50",
            )}
            title={
              labelMismatch
                ? `Detected ${project.activeAgents.map(agentLabel).join(", ")} running, but preference shows ${agentLabel(localAgentId ?? project.agentPref ?? "?")}. Open project settings or use Brain config to align.`
                : `Live agent in this workspace: ${runtimeLabel}. Click the agent chip on an open tab to switch without typing quit commands in the terminal.`
            }
          >
            {runtimeStateLabel}
            {labelMismatch && !compact && (
              <span className="ml-1 text-status-warning">· mismatch</span>
            )}
          </span>
        ))}

      {/* Agent-declared "I'm blocked on you" state. Sourced from session.md
          (health contains "awaiting user" OR status: blocked) — the agent
          itself raises this via the blocker_create flow. Takes priority
          over the loop-spiral chip because it tells the captain WHY the
          loop isn't progressing. */}
      {showAwaitingUser && (
        <span
          className={compact ? "text-status-warning" : statusChipClass("warning")}
          title={`Agent is waiting on you. Last reported next step: "${project.session?.next ?? "(none)"}". Open the project's session handoff or check ~/.loki/sessions/${project.tab}.blockers/pending/ for the blocker file.`}
        >
          Needs input
        </span>
      )}

      {/* Loop spiral detection. The agent writes `done: No-op turn #N.` when
          the autopilot loop fires a turn with nothing to do; counting those
          is the cheapest spiral-detector available. Visible only when the
          agent is "ready" AND has logged N>=2 no-op turns. Once the bash
          guard sees the same signal it stops firing, so this chip should
          disappear within one tick of the next session.md write — if it
          persists, the wrapper isn't calling autopilot-needs-fire. */}
      {showLoopSpiral && (
        <span
          className={compact ? "text-status-warning" : statusChipClass("warning")}
          title={`Autopilot loop has fired ${loop.noOpCount} consecutive no-op turns. The bash guard (~/.claude/bin/autopilot-needs-fire) should stop further firings; if you see this count keep climbing, the wrapper isn't calling the guard.`}
        >
          Looping · {loop.noOpCount} no-ops
        </span>
      )}

      {/* Per-project pause indicator — makes the existing auto-continue toggle obvious at card level */}
      {!autoContinueEnabled && (
        <span
          className={compact ? "text-status-warning" : statusChipClass("warning")}
          title="Automatic continuation (auto-injections when the agent waits) is paused for this project. Click the pause/play button in the input area to resume."
        >
          Auto paused
        </span>
      )}

      {readiness.reason === "no_path" && (
        <span
          className={compact ? "text-status-warning" : statusChipClass("warning")}
          title={readiness.description}
        >
          Not connected
        </span>
      )}

      {/* Address the project; Terminal resolves its worker session. */}
      {clickableWorkspace && (
        <Link
          href={fleetSurfaceHref("terminal", project.tab)}
          onClick={(event) => event.stopPropagation()}
          title="Open this project’s terminal. Running an agent requires an eligible cloud runner or your connected Fleet Runner."
          className={
            compact
              ? "text-text-tertiary transition-colors hover:text-text-primary"
              : statusChipClass("neutral", true)
          }
        >
          {!compact && <SquareTerminal className="h-3.5 w-3.5" />}
          Open terminal
        </Link>
      )}

      {git && compact && (
        <span className={cn(git.dirty && "text-status-warning")} title={dirtyHelp}>
          {changesLabel ?? git.branch}
        </span>
      )}

      {git && !compact && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setGitHelpOpen((open) => !open);
          }}
          className={statusChipClass(git.dirty ? "warning" : "neutral", true)}
          title={dirtyHelp}
        >
          <GitBranch className="h-3.5 w-3.5" />
          <span className="max-w-[16rem] truncate">{changesLabel ?? git.branch}</span>
        </button>
      )}

      {git && git.behindRemote > 0 && (
        <span
          className="text-status-warning"
          title={`${git.behindRemote} commit${git.behindRemote > 1 ? "s" : ""} from GitHub are not on this computer yet.`}
        >
          Behind {git.behindRemote}
        </span>
      )}
    </div>
  );

  if (compact || !gitHelpOpen || !git) return chips;

  return (
    <div className="space-y-2">
      {chips}
      <div className="max-w-xl rounded-xl border border-border-subtle bg-surface-raised px-3.5 py-3 text-xs leading-relaxed text-text-tertiary">
        {git.dirty ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-text-secondary">
                  {changesLabel} on <span className="font-mono">{git.branch}</span>
                </p>
                <p className="mt-1 text-text-muted">
                  Uncommitted edits — not yet saved into Git history.
                </p>
              </div>
              {project.dir && (
                <button
                  type="button"
                  onClick={quickCommit}
                  disabled={commitState === "committing"}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    commitState === "done"
                      ? "border-status-positive/40 bg-status-positive/10 text-status-positive"
                      : commitState === "error"
                        ? "border-status-negative/40 bg-status-negative-subtle text-status-negative"
                        : "border-border-default bg-surface-overlay text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50",
                  )}
                  title="Stage all changes, commit with a checkpoint message, and push to origin"
                >
                  {commitState === "committing" && <Loader2 className="h-3 w-3 animate-spin" />}
                  {commitState === "done" && <Check className="h-3 w-3" />}
                  {commitState === "error" && <span>!</span>}
                  {(commitState === "idle" || commitState === "committing") && (
                    <UploadCloud
                      className={cn("h-3 w-3", commitState !== "committing" && "block")}
                    />
                  )}
                  <span>
                    {commitState === "committing"
                      ? "Committing…"
                      : commitState === "done"
                        ? commitResult?.sha
                          ? `Pushed ${commitResult.sha}`
                          : "Pushed ✓"
                        : commitState === "error"
                          ? (commitResult?.error ?? "Failed")
                          : "Commit & push"}
                  </span>
                </button>
              )}
            </div>
          </>
        ) : (
          <p>
            Clean on <span className="font-medium text-text-secondary font-mono">{git.branch}</span>{" "}
            — no pending changes.
          </p>
        )}
      </div>
    </div>
  );
}
