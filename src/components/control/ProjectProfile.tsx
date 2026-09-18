"use client";

import { useState, useMemo } from "react";
import {
  DEFAULT_BUILDER_CHANNEL,
  HOSTED_BUILDER_PREF,
  type BuilderPref,
} from "@/lib/constants/statuses";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import Link from "next/link";
import { ExternalLink, GitBranch, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFetch } from "@/hooks/use-fetch";
import { patchJson } from "@/lib/api/fetch";
import type { AgentPrompt } from "@/app/api/prompts/agent/route";
import type { ProjectState } from "@/lib/control-types";
import type { UserProject } from "@/db/schema/user-projects";
import { DIMENSION_META, DimensionSection } from "./project-profile-sections";
import { NotesSection } from "./project-profile-helpers";
import { buildSessionHandoffFromProjectSession, SessionHandoff } from "./SessionHandoff";
import { describeDispatchTarget } from "@/lib/dispatch-target";

type AgentEntry = { id: string; label: string; modelSuggestions: string[] };
type AgentId = string;

const BUILDER_CHOICES: { id: BuilderPref; label: string; detail?: string }[] = [
  { id: "cloud", label: EXECUTOR_COPY.builder.cloudChoice },
  { id: "local", label: EXECUTOR_COPY.builder.localChoice },
  {
    id: HOSTED_BUILDER_PREF,
    label: EXECUTOR_COPY.builder.hostedChoice,
    detail: EXECUTOR_COPY.builder.hostedDetail,
  },
];

function ProjectContextSummary({ project }: { project: ProjectState }) {
  const handoff = buildSessionHandoffFromProjectSession(project.session);
  const profile = project.profile;
  const recentCommits = project.git?.recentCommits?.slice(0, 3) ?? [];

  return (
    <div className="border-t border-border-subtle px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="ui-kicker text-accent-text">Run context</p>
        <div className="flex flex-wrap items-center gap-3">
          {project.projectId && (
            <Link
              href={`/projects/${project.projectId}`}
              className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-accent-text hover:underline"
            >
              Full project profile <ExternalLink className="h-3 w-3" />
            </Link>
          )}
          {profile?.url && (
            <a
              href={profile.url.startsWith("http") ? profile.url : `https://${profile.url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-micro text-text-muted transition-colors hover:text-text-secondary"
            >
              Open product <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <div>
            <p className="ui-kicker">Mission</p>
            <p className="mt-1 text-sm leading-relaxed text-text-primary">
              {profile?.mission || profile?.description || "No mission saved yet."}
            </p>
          </div>
          {profile?.stack && (
            <div>
              <p className="ui-kicker">Stack</p>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{profile.stack}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {project.dir && (
            <div className="flex min-w-0 gap-2 text-sm text-text-secondary">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="truncate" title={project.dir}>
                {project.dir}
              </span>
            </div>
          )}
          {project.git && (
            <div className="flex min-w-0 gap-2 text-sm text-text-secondary">
              <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="truncate" title={project.git.branch}>
                {project.git.branch}
                {project.git.dirty ? ` · ${project.git.dirtyCount || 1} pending` : ""}
              </span>
            </div>
          )}
          {recentCommits.length > 0 && (
            <div className="space-y-1.5">
              <p className="ui-kicker">Recent commits</p>
              {recentCommits.map((commit) => (
                <p key={commit} className="truncate text-xs text-text-tertiary" title={commit}>
                  {commit}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {handoff && (
        <div className="mt-4 border-t border-border-subtle pt-3">
          <SessionHandoff data={handoff} surface="plain" microLabels />
        </div>
      )}
    </div>
  );
}

export function ProjectProfile({
  project,
  globalAdapter,
  localAgent,
  availableAgents,
  onSetAgent,
  onFillPrompt,
  onRunPrompt,
}: {
  project: ProjectState;
  globalAdapter: string;
  localAgent: AgentId | null;
  availableAgents: AgentEntry[];
  onSetAgent: (agent: AgentId | null) => void;
  /** Drops the interpolated prompt template into the composer textarea so the
   *  user can preview/edit before sending. Default behavior for every prompt
   *  click — universal fill-first rule shipped 2026-05-31. */
  onFillPrompt: (prompt: string) => void;
  /** Send-immediate for prompts flagged sendNow:true in the SSOT (hard_stop
   *  kill switch, etc.). Surfaced as a small ↪ button next to the fill action. */
  onRunPrompt: (prompt: string, agent: string) => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [localModel, setLocalModel] = useState<string | null>(project.modelPref ?? null);
  const activeAgent =
    localAgent ?? (project.agentPref as AgentId | null) ?? (globalAdapter as AgentId);

  const persistAgentPref = (agentId: AgentId | null) => {
    if (project.id) {
      patchJson(`/api/user-projects/${project.id}`, { agentPref: agentId ?? undefined }).catch(
        () => {},
      );
    }
    onSetAgent(agentId);
  };

  const [localBuilder, setLocalBuilder] = useState<string | null>(project.builderPref ?? null);
  const persistBuilderPref = (channel: BuilderPref | null) => {
    setLocalBuilder(channel);
    if (project.id) {
      patchJson(`/api/user-projects/${project.id}`, { builderPref: channel ?? undefined }).catch(
        () => {},
      );
    }
  };

  const persistModelPref = (model: string | null) => {
    setLocalModel(model);
    if (project.id) {
      patchJson(`/api/user-projects/${project.id}`, { modelPref: model ?? undefined }).catch(
        () => {},
      );
    }
  };

  const { data: allPrompts } = useFetch<AgentPrompt[]>("/api/prompts/agent");
  const { data: userProject } = useFetch<UserProject>(
    project.id ? `/api/user-projects/${project.id}` : null,
  );
  const dimensionGroups = useMemo(() => {
    if (!allPrompts) return [];
    const byDim = new Map<string, AgentPrompt[]>();
    for (const p of allPrompts) {
      if (!p.dimensionId || p.style === "internal") continue;
      if (!byDim.has(p.dimensionId)) byDim.set(p.dimensionId, []);
      byDim.get(p.dimensionId)!.push(p);
    }
    return Object.keys(DIMENSION_META)
      .filter((id) => byDim.has(id))
      .map((id) => ({
        id,
        prompts: byDim.get(id)!,
      }));
  }, [allPrompts]);

  const usageCounts = new Map<string, number>();
  for (const r of project.recentCustomPrompts) {
    usageCounts.set(r.customPrompt, r.count);
  }

  const handleRun = async (prompt: string) => {
    setSending(true);
    try {
      await onRunPrompt(prompt, activeAgent);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <ProjectContextSummary project={project} />

      {/* Agent selector */}
      <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <span className="ui-kicker shrink-0">Agent</span>
        <div className="flex flex-wrap gap-1.5">
          {availableAgents.map((a) => (
            <button
              key={a.id}
              onClick={() => persistAgentPref(localAgent === a.id ? null : (a.id as AgentId))}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                activeAgent === a.id
                  ? "border-accent-primary/50 bg-accent-primary/10 text-accent-text"
                  : "border-border-subtle bg-surface-base text-text-tertiary hover:text-text-secondary hover:border-border-default",
              )}
            >
              {a.label}
              {a.id === globalAdapter && localAgent === null && (
                <span className="ml-1.5 opacity-40">✓</span>
              )}
            </button>
          ))}
        </div>
        {sending && <Loader2 className="ml-auto ui-spinner-sm text-text-muted" />}
      </div>

      {/* Builder selector — where this project's work runs. Stored on the
          project; routing never guesses it from which runner is online. */}
      <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <span className="ui-kicker shrink-0">Runs on</span>
        <div className="flex flex-wrap gap-1.5">
          {BUILDER_CHOICES.map((c) => (
            <button
              key={c.id}
              title={c.detail}
              onClick={() => persistBuilderPref(c.id === DEFAULT_BUILDER_CHANNEL ? null : c.id)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                (localBuilder ?? DEFAULT_BUILDER_CHANNEL) === c.id
                  ? "border-accent-primary/50 bg-accent-primary/10 text-accent-text"
                  : "border-border-subtle bg-surface-base text-text-tertiary hover:text-text-secondary hover:border-border-default",
              )}
            >
              {c.label}
              {c.id === DEFAULT_BUILDER_CHANNEL && (
                <span className="ml-1.5 opacity-40">default</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Model selector — shows suggestions for the active agent */}
      {(() => {
        const agentEntry = availableAgents.find((a) => a.id === activeAgent);
        const suggestions = agentEntry?.modelSuggestions ?? [];
        if (suggestions.length === 0) return null;
        const activeModel = localModel ?? suggestions[0];
        return (
          <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:px-5">
            <span className="ui-kicker shrink-0">Model</span>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((m) => (
                <button
                  key={m}
                  onClick={() => persistModelPref(m === suggestions[0] ? null : m)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                    activeModel === m
                      ? "border-accent-primary/50 bg-accent-primary/10 text-accent-text"
                      : "border-border-subtle bg-surface-base text-text-tertiary hover:text-text-secondary hover:border-border-default",
                  )}
                >
                  {m}
                  {m === suggestions[0] && <span className="ml-1.5 opacity-40">default</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* What a dispatch from here will actually do. The three controls above
          each set one part of it and none of them states the combination, so
          the first time the operator saw agent + model + machine together was
          on the run record, afterwards. The cost is the LAST run's, measured:
          what this one will cost cannot be known, and a predicted number beside
          a button reads as a quote. */}
      {(() => {
        const agentEntry = availableAgents.find((a) => a.id === activeAgent);
        const suggestions = agentEntry?.modelSuggestions ?? [];
        const view = describeDispatchTarget({
          agentLabel: agentEntry?.label ?? activeAgent,
          model: suggestions.length ? (localModel ?? suggestions[0]) : null,
          channel: localBuilder ?? DEFAULT_BUILDER_CHANNEL,
          lastRun: project.latestOrchestrationRun
            ? {
                costUsd: project.latestOrchestrationRun.costUsd,
                error: project.latestOrchestrationRun.payload?.error ?? null,
              }
            : null,
        });
        return (
          <div className="flex flex-col gap-1 border-t border-border-subtle px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ui-kicker shrink-0">Dispatch runs</span>
              <span className="text-xs font-medium text-text-secondary">{view.line}</span>
              {view.cost && (
                <span
                  className="ui-tag ui-tag-neutral tabular-nums"
                  title="What the previous run on this project cost. Not an estimate for this one."
                >
                  last run {view.cost}
                </span>
              )}
            </div>
            {view.caution && <p className="ui-error text-xs">{view.caution}</p>}
          </div>
        );
      })()}

      {/* Dimension prompt sections — sourced via /api/prompts/agent which merges
          src/config/prompt-library.ts (SSOT) with the legacy JSON file. */}
      {dimensionGroups.map(({ id, prompts }) => (
        <DimensionSection
          key={id}
          dimensionId={id}
          prompts={prompts}
          project={project}
          usageCounts={usageCounts}
          isSending={sending}
          onFill={onFillPrompt}
          onRun={handleRun}
        />
      ))}

      {/* Per-project notes / scratchpad */}
      {project.id && <NotesSection projectId={project.id} project={userProject} />}
    </div>
  );
}
