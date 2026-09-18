"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import type { BuilderChannel } from "@/lib/event-stream-types";
import type { TerminalLaunchProject } from "@/app/api/terminal/context/route";

/**
 * Start an agent from the empty terminal, in place.
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
}: {
  projects: TerminalLaunchProject[];
  agents: { id: string; label: string }[];
  defaultAgent: string | null;
  /** Null until the client knows it (SSR) or when no project is in scope. */
  activeProject?: string | null;
  channel: BuilderChannel;
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

  if (startedAs) {
    return (
      <p className="text-center text-xs text-text-muted">
        Starting {startedAs} in “{projectName}” — the session appears above when it&apos;s up.
      </p>
    );
  }

  const start = async () => {
    if (!project || !agentId) return;
    setBusy(true);
    setError("");
    try {
      await postJson("/api/agent/launch", {
        tab: project.name,
        dir: project.dir,
        agent: agentId,
        channel,
      });
      setStartedAs(agents.find((a) => a.id === agentId)?.label ?? agentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <select
          className="ui-input-compact"
          aria-label="Project to start an agent in"
          value={projectName}
          onChange={(e) => setProjectOverride(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="ui-input-compact"
          aria-label="Agent to start"
          value={agentId}
          onChange={(e) => setAgentOverride(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ui-btn-primary"
          onClick={() => void start()}
          disabled={busy || !project || !agentId}
        >
          {busy ? <Loader2 className="ui-spinner" /> : <Play className="h-3.5 w-3.5" />}
          Start here
        </button>
      </div>
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}
