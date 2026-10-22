"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import type { BuilderChannel } from "@/lib/event-stream-types";
import type { TerminalLaunchProject } from "@/app/api/terminal/context/route";
import { MAX_PARALLEL_LANES_PER_PROJECT, nextSessionTab, sessionsOfProject } from "@/lib/run-tab";
import { projectTitle } from "@/lib/project-display";

/**
 * Start an agent from the empty session view, in place.
 *
 * The empty state used to end in "go to Loki / go to Control" — the one page
 * whose whole job is the live session sent you elsewhere to create one. This
 * posts the same /api/agent/launch the Control launch modal uses, pinned to the
 * builder the user is currently looking at, so the session appears in the very
 * strip above this form within one poll.
 *
 * `activeProject` is the project the operator is already looking at. It used to
 * default to `projects[0]` — whichever project happened to sort first — while
 * the breadcrumb above said something else entirely, so the obvious click
 * started an agent in the wrong repository. The agent select was already
 * careful to honour `project.agentPref`; it was just reading the preference off
 * a project nobody had chosen.
 */
/**
 * Which project the launcher offers before the operator picks one.
 *
 * Pure and exported so the rule can be pinned without React: the bug it fixes
 * was invisible in every test that rendered nothing, and reads as a styling
 * choice on screen.
 */
export function preferredLaunchProject(
  projects: TerminalLaunchProject[],
  activeProject: string | null | undefined,
): string {
  // Only when it is actually launchable — a project in scope but with no linked
  // directory cannot be started, and pre-selecting it would offer a button that
  // fails every time.
  if (activeProject && projects.some((p) => p.name === activeProject)) return activeProject;
  return projects[0]?.name ?? "";
}

export function TerminalLaunch({
  projects,
  agents,
  defaultAgent,
  activeProject,
  channel,
  openTabs = [],
  onStarted,
  onOpenSession,
  framed = true,
}: {
  projects: TerminalLaunchProject[];
  agents: { id: string; label: string }[];
  defaultAgent: string | null;
  /** Null until the client knows it (SSR) or when no project is in scope. */
  activeProject?: string | null;
  channel: BuilderChannel;
  /** Sessions already open on this builder. Starting a project that has one
   *  opens a SECOND session beside it (its own worktree), never a replacement. */
  openTabs?: readonly string[];
  /** The tab the new session will appear as — the caller switches to it. */
  onStarted?: (tab: string) => void;
  /** Go to a session that is already open instead of starting another. */
  onOpenSession?: (tab: string) => void;
  /** False inside a sheet, which is already the frame. */
  framed?: boolean;
}) {
  const [projectOverride, setProjectOverride] = useState<string | null>(null);
  const [agentOverride, setAgentOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [startedAs, setStartedAs] = useState<string | null>(null);

  // DERIVED, not initial state. `activeProject` is null on the first render —
  // it comes from a store the server cannot read — and arrives a tick later.
  // A `useState(initialiser)` would capture that null forever and quietly go
  // back to picking the first project in the list, which is the bug this is
  // fixing. Same shape as the agent selection just below: the operator's own
  // pick wins, and until they make one the scope answers.
  const projectName = projectOverride ?? preferredLaunchProject(projects, activeProject);
  const project = projects.find((p) => p.name === projectName) ?? null;
  // Per-project preference wins until the user explicitly picks an agent.
  const agentId =
    agentOverride ??
    (project?.agentPref && agents.some((a) => a.id === project.agentPref)
      ? project.agentPref
      : (defaultAgent ?? agents[0]?.id ?? ""));

  if (projects.length === 0 || agents.length === 0) return null;

  const running = project ? sessionsOfProject(openTabs, project.name) : [];
  const full = running.length > MAX_PARALLEL_LANES_PER_PROJECT;

  if (startedAs) {
    // A live state, drawn as one: it used to be a sentence with no spinner,
    // and read as a dead end until the session appeared (owner, 2026-10-19).
    return (
      <p
        className="flex items-center justify-center gap-2 text-center text-sm text-text-secondary"
        role="status"
      >
        <Loader2 className="ui-spinner h-4 w-4 shrink-0" aria-hidden="true" />
        Opening {startedAs} in “{projectName}” — the session appears here in a moment.
      </p>
    );
  }

  const start = async () => {
    if (!project || !agentId) return;
    const tab = nextSessionTab(openTabs, project.name, crypto.randomUUID());
    if (!tab) return;
    setBusy(true);
    setError("");
    try {
      await postJson("/api/agent/launch", {
        tab,
        dir: project.dir,
        agent: agentId,
        channel,
      });
      setStartedAs(agents.find((a) => a.id === agentId)?.label ?? agentId);
      onStarted?.(tab);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={
        framed
          ? "ui-card-shell mt-3 flex w-full max-w-xl flex-col gap-3 p-3 text-left"
          : "flex w-full flex-col gap-3 text-left"
      }
    >
      <h2 className="ui-section-heading">New session</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="ui-micro-label">Project</span>
          <select
            id="terminal-launch-project"
            className="ui-input-compact"
            value={projectName}
            onChange={(e) => setProjectOverride(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {projectTitle(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="ui-micro-label">Agent</span>
          <select
            id="terminal-launch-agent"
            className="ui-input-compact"
            value={agentId}
            onChange={(e) => setAgentOverride(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {running.length > 0 && (
        <p className="text-xs text-text-secondary">
          {full
            ? `${projectTitle({ name: projectName })} already has ${running.length} sessions, the most one project runs at once. Close one to start another.`
            : `${projectTitle({ name: projectName })} already has a session. Another one works in its own copy, so the two never get in each other’s way.`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="ui-btn-primary"
          onClick={() => void start()}
          disabled={busy || !project || !agentId || full}
        >
          {busy ? <Loader2 className="ui-spinner" /> : <Play className="h-3.5 w-3.5" />}
          {running.length > 0 ? "Start another session" : "Start"}
        </button>
        {running.length > 0 && onOpenSession ? (
          <button
            type="button"
            className="ui-btn-secondary"
            onClick={() => onOpenSession(running[0])}
          >
            Go to its session
          </button>
        ) : null}
      </div>
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}
