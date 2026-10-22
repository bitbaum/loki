"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import type { BuilderChannel } from "@/lib/event-stream-types";
import type { TerminalLaunchProject } from "@/app/api/terminal/context/route";
import { nextSessionTab } from "@/lib/run-tab";
import { projectTitle } from "@/lib/project-display";
import { List, ListRow, RowInitial } from "@/components/ui/list-row";

/** Names a second session's copy of the project. randomUUID exists only in
 *  a secure context, so plain http (a preview, a test) gets a random string. */
function sessionSuffix(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

/** Agents whose CLI can continue this folder's newest conversation. */
const RESUMABLE = new Set(["claude", "codex"]);
const canResume = (agent: string) => RESUMABLE.has(agent);

/** How many recent projects the empty view lists before "All projects". */
const SHOWN = 5;

/**
 * The terminal with nothing open: your projects, each one tap from its
 * session — and for Claude, from the same conversation, not a blank one.
 *
 * It replaced a form (Project ▾, Agent ▾, an orange "Start agent on Cloud
 * builder") under "No live sessions", which read as if the sessions had never
 * existed (owner, 2026-10-19: "it's like I didn't start the sessions before").
 * A person who comes back here wants what they had, so the row says what
 * Resume does: it opens the project and continues its last conversation
 * (`claude --resume`, `codex resume --last`, on the builder). The other
 * agents' CLIs cannot reopen the conversation that belongs to THIS folder
 * (Cursor's resume reaches across every project), so theirs says Start.
 */
export function TerminalResume({
  projects,
  agents,
  defaultAgent,
  activeProject,
  channel,
  openTabs = [],
  onStarted,
  onAllProjects,
}: {
  projects: TerminalLaunchProject[];
  agents: { id: string; label: string }[];
  defaultAgent: string | null;
  /** The project in scope — listed first. */
  activeProject?: string | null;
  channel: BuilderChannel;
  openTabs?: readonly string[];
  onStarted?: (tab: string) => void;
  /** Every project, with a choice of agent (the new-session sheet). */
  onAllProjects?: () => void;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (projects.length === 0 || agents.length === 0) return null;

  const ordered = [
    ...projects.filter((p) => p.name === activeProject),
    ...projects.filter((p) => p.name !== activeProject),
  ].slice(0, SHOWN);
  const agentFor = (p: TerminalLaunchProject) =>
    p.agentPref && agents.some((a) => a.id === p.agentPref)
      ? p.agentPref
      : (defaultAgent ?? agents[0]!.id);
  const labelOf = (id: string) => agents.find((a) => a.id === id)?.label ?? id;

  const open = async (p: TerminalLaunchProject) => {
    const agent = agentFor(p);
    const tab = nextSessionTab(openTabs, p.name, sessionSuffix());
    if (!tab) return;
    setOpening(p.name);
    setError("");
    try {
      await postJson("/api/agent/launch", {
        tab,
        dir: p.dir,
        agent,
        channel,
        resume: canResume(agent),
      });
      onStarted?.(tab);
    } catch (e) {
      setOpening(null);
      setError(e instanceof Error ? e.message : "It did not open. Try again.");
    }
  };

  if (opening) {
    return (
      <p className="ui-term-resume-opening" role="status">
        <Loader2 className="ui-spinner h-4 w-4 shrink-0" aria-hidden="true" />
        Opening {projectTitle({ name: opening })}…
      </p>
    );
  }

  return (
    <div className="ui-term-resume">
      <List aria-label="Your projects">
        {ordered.map((p) => {
          const agent = agentFor(p);
          const verb = canResume(agent) ? "Resume" : "Start";
          const name = projectTitle(p);
          return (
            <ListRow
              key={p.name}
              onClick={() => void open(p)}
              label={`${verb} ${name}`}
              avatar={<RowInitial name={name} />}
              title={name}
              secondary={
                verb === "Resume"
                  ? `${labelOf(agent)} · where you left off`
                  : `${labelOf(agent)} · a new session`
              }
              trailing={<span className="ui-term-resume-go">{verb}</span>}
            />
          );
        })}
      </List>
      {error && <p className="ui-error">{error}</p>}
      {onAllProjects && (
        <button type="button" className="ui-btn-ghost min-h-11 self-start" onClick={onAllProjects}>
          Another project
        </button>
      )}
    </div>
  );
}
