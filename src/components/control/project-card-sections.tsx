"use client";

import { useState } from "react";
import {
  Circle,
  ExternalLink,
  SlidersHorizontal,
  ChevronsDown,
  Focus,
  FolderKanban,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { compactRelativeDate } from "@/lib/dates";
import { postJson } from "@/lib/api/fetch";
import type { ProjectState } from "@/lib/control-types";
import { buildSessionHandoffFromProjectSession, SessionHandoff } from "./SessionHandoff";
import { ProjectStatusChips } from "./ProjectStatusChips";
import type { AgentEntry } from "./agent-switcher-popover";
import { OutcomeStreak } from "./OutcomeStreak";
import { STATE_DEFINITIONS, type ProjectStateKey } from "@/lib/control-states";

/**
 * Does the subtitle merely say the badge again?
 *
 * True when one label's words are a subset of the other's, ignoring case,
 * order and punctuation — so "Tab open" vs "Workspace tab open" is caught,
 * while "Tab open" vs "Last run completed" is not.
 *
 * Exported so the rule is testable without rendering a card. The version this
 * replaces was `a !== b`: correct-looking, and catching only the one phrasing
 * nobody was ever going to write twice.
 */
export function restatesLabel(evidence: string, stateLabel: string): boolean {
  const words = (v: string) =>
    new Set(
      v
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
  const a = words(evidence);
  const b = words(stateLabel);
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (!large.has(w)) return false;
  return true;
}

export function ProjectCardHeader({
  project,
  tabOpen,
  isReady,
  isOrchReady,
  isRunning,
  stateKey,
  stateLabel,
  stateTagClass,
  evidenceLabel,
  evidenceAt,
  evidenceKind,
  profileOpen,
  onProfileToggle,
  onCollapse,
  onFocus,
  availableAgents,
  localAgentId,
  switchingAgent,
  onSwitchAgent,
  runtimeStateKnown = true,
}: {
  project: ProjectState;
  tabOpen: boolean;
  isReady: boolean;
  isOrchReady: boolean;
  isRunning: boolean;
  stateKey: ProjectStateKey;
  stateLabel: string;
  stateTagClass: string;
  evidenceLabel?: string;
  evidenceAt?: number | null;
  evidenceKind?: "live" | "historical" | "unknown";
  profileOpen: boolean;
  onProfileToggle: () => void;
  onCollapse?: () => void;
  onFocus?: () => void;
  availableAgents?: AgentEntry[];
  localAgentId?: string | null;
  switchingAgent?: boolean;
  onSwitchAgent?: (agentId: string | null) => void;
  runtimeStateKnown?: boolean;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const { git, session, profile } = project;

  const lastActiveMs = session?.mtime ?? (project.closedAt ? project.closedAt * 1000 : null);
  const lastActiveLabel = lastActiveMs
    ? compactRelativeDate(new Date(lastActiveMs))
    : (git?.lastWhen ?? null);

  // The dot color, description (hover), and problem hint all come from the
  // SSOT (STATE_DEFINITIONS) keyed by `stateKey`. Adding a state can never
  // ship without an explicit dot class — the Record type enforces it.
  // Hand-rolled local color trees that drifted (gray vs brown vs green
  // depending on which component looked at it) are gone.
  const stateDefinition = STATE_DEFINITIONS[stateKey];
  // Dot uses `text-current fill-current` on the Circle below + the
  // text-color form of the same semantic token. The "bg-*" classes in
  // STATE_DEFINITIONS apply to the dot variants used elsewhere
  // (ProjectOperationsView's rail), so map them to the text-color
  // equivalent for this inline Circle icon.
  const DOT_BG_TO_TEXT: Record<string, string> = {
    "bg-status-warning": "text-status-warning",
    "bg-status-positive": "text-status-positive",
    "bg-accent-primary animate-pulse": "text-accent-text animate-pulse",
    "bg-border-default": "text-text-muted",
    "bg-border-strong": "text-text-secondary",
  };
  const dotColor = DOT_BG_TO_TEXT[stateDefinition.dotClass] ?? "text-text-muted";
  const stateDescription = stateDefinition.description;
  const stateProblem = stateDefinition.problem;

  return (
    <div className="px-4 py-4 sm:px-5 md:px-6">
      <div className="ui-card-header !mb-0">
        <div className="ui-card-header-main space-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Circle className={cn("h-2.5 w-2.5 shrink-0 fill-current", dotColor)} />
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  className="truncate text-base font-semibold text-text-primary sm:text-lg"
                  title={project.tab}
                >
                  {project.tab}
                </span>
                {/* When we have a real handoff with "next", show the actual next step instead of generic "Ready for next step".
                    This reduces the duplicate "Ready for next step ✓ ✓" noise the user reported. */}
                {(isReady || isOrchReady) && project.session?.next?.trim() ? (
                  <span className={cn("gap-1.5", stateTagClass)} title={stateDescription}>
                    Next: {project.session.next.split("\n")[0].slice(0, 60)}
                  </span>
                ) : (
                  <span className={cn("gap-1.5", stateTagClass)} title={stateDescription}>
                    {stateLabel}
                  </span>
                )}
                {/* When the state itself signals a problem (e.g. Offline →
                    runner needs starting), surface the remediation as a
                    small action chip the user can click. Honest by
                    construction: only renders when STATE_DEFINITIONS says
                    this state HAS a fix the user should take. */}
                {stateProblem &&
                  (stateProblem.ctaHref ? (
                    <Link
                      href={stateProblem.ctaHref}
                      className="ui-tag ui-tag-warning gap-1"
                      title={stateProblem.hint}
                    >
                      {stateProblem.ctaLabel ?? "Fix"}
                    </Link>
                  ) : (
                    <span className="ui-tag ui-tag-warning gap-1" title={stateProblem.hint}>
                      {stateProblem.ctaLabel ?? "Action needed"}
                    </span>
                  ))}
                <OutcomeStreak outcomes={project.recentOutcomes} projectKey={project.tab} />
              </div>
              {/* Suppress the subtitle when it would just repeat the badge
                  with no timestamp to add ("Awaiting input / Awaiting input").

                  Exact equality was not enough. The badge read "Tab open" and
                  the subtitle read "Workspace tab open" — the same fact in
                  different words, on every card in that state, and the guard
                  waved it through because the strings differ by one word. It
                  compares the WORDS now, ignoring case, order and punctuation,
                  so a rewording cannot slip past it again. */}
              {evidenceLabel &&
                (!restatesLabel(evidenceLabel, stateLabel) || (evidenceAt && lastActiveLabel)) && (
                  <p
                    className="mt-0.5 text-xs text-text-muted"
                    title={
                      evidenceKind === "historical"
                        ? "Historical saved agent context; this is not live activity."
                        : undefined
                    }
                  >
                    {evidenceLabel}
                    {evidenceAt && lastActiveLabel ? ` ${lastActiveLabel}` : ""}
                  </p>
                )}
              {/* Profile status when no health available (any state) */}
              {profile?.status && !session?.health && (
                <p className="mt-1 truncate text-sm text-text-tertiary" title={profile.status}>
                  {profile.status}
                </p>
              )}
            </div>
          </div>

          <ProjectStatusChips
            project={project}
            tabOpen={tabOpen}
            availableAgents={availableAgents}
            localAgentId={localAgentId}
            switchingAgent={switchingAgent}
            onSwitchAgent={onSwitchAgent}
            isAgentWorking={isRunning}
            runtimeStateKnown={runtimeStateKnown}
          />
          {git && git.behindRemote > 0 && (
            <div className="ui-control-card-header-meta">
              <button
                onClick={async () => {
                  setSyncing(true);
                  setSyncResult(null);
                  try {
                    const res = await postJson("/api/project/sync", { dir: project.dir });
                    const data = await res.json();
                    setSyncResult(res.ok ? "✓" : (data.error ?? "Failed"));
                  } finally {
                    setSyncing(false);
                  }
                }}
                disabled={syncing}
                title="Bring the latest saved work from GitHub onto this computer."
                className="ui-chip-action-compact border-status-warning/30 text-status-warning hover:text-text-primary"
              >
                {syncing ? "…" : "Update from GitHub"}
              </button>
              {syncResult && <span>{syncResult}</span>}
            </div>
          )}
        </div>

        <div className="ui-card-actions shrink-0 self-start">
          {project.projectId && (
            <Link
              href={`/projects/${project.projectId}`}
              className="ui-icon-action"
              title="Project details"
              aria-label="Open project details"
            >
              <FolderKanban className="h-4 w-4" />
            </Link>
          )}
          {profile?.url && (
            <a
              href={profile.url.startsWith("http") ? profile.url : `https://${profile.url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-icon-action"
              title="Open the live project URL"
              aria-label="Open the live project URL"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <button
            onClick={onProfileToggle}
            title={profileOpen ? "Close run setup" : "Agent, model, and prompt setup"}
            aria-label={profileOpen ? "Close run setup" : "Open agent, model, and prompt setup"}
            aria-pressed={profileOpen}
            className={cn("ui-icon-action", profileOpen ? "text-accent-text" : "text-text-muted")}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          {onFocus && (
            <button
              onClick={onFocus}
              title="Focus on this project"
              aria-label="Focus on this project"
              className="ui-icon-action"
            >
              <Focus className="h-4 w-4" />
            </button>
          )}
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse"
              aria-label="Collapse this project card"
              className="ui-icon-action"
            >
              <ChevronsDown className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SessionSummary({
  session,
  isClosed,
}: {
  session: ProjectState["session"];
  isClosed: boolean;
}) {
  if (isClosed || !session) return null;
  return <SessionHandoff data={buildSessionHandoffFromProjectSession(session)} />;
}
