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
 */
export function TerminalLaunch({
  projects,
  agents,
  defaultAgent,
  channel,
}: {
  projects: TerminalLaunchProject[];
  agents: { id: string; label: string }[];
  defaultAgent: string | null;
  channel: BuilderChannel;
}) {
  const [projectName, setProjectName] = useState(projects[0]?.name ?? "");
  const [agentOverride, setAgentOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [startedAs, setStartedAs] = useState<string | null>(null);

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
    <div className="flex flex-col items-center gap-3">
      {/* Launch form — one row, consistent sizing */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <select
          className="ui-chip-toggle min-w-[120px] cursor-pointer appearance-none bg-surface-base pr-7 font-normal"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L2 4h8z'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 0.75rem center",
          }}
          aria-label="Project to start an agent in"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="ui-chip-toggle min-w-[100px] cursor-pointer appearance-none bg-surface-base pr-7 font-normal"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L2 4h8z'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 0.75rem center",
          }}
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
          className="ui-btn-primary ui-btn-xs inline-flex items-center gap-1.5"
          onClick={() => void start()}
          disabled={busy || !project || !agentId}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Start
        </button>
      </div>
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}
