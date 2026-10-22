"use client";

import Link from "next/link";
import { FolderGit2, Sparkles } from "lucide-react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { BrainConfigPanel } from "./control-panel-helpers";
import { EmptyStateWelcome } from "./EmptyStateWelcome";
import { GitHubRepoSuggestions } from "./GitHubRepoSuggestions";
import { LocalDevSuggestions } from "./LocalDevSuggestions";

/**
 * New-user welcome card. Shows ONLY when the user has zero registered
 * projects — the dead-end blank /control was the worst first-touch we had.
 * Three CTAs: import from GitHub (multi-select), add manually, install Fleet
 * Runner. Disappears the moment they add anything.
 */
export function ControlEmptyState({
  onAddManual,
  onBootstrap,
  registeredCount = 0,
}: {
  onAddManual: () => void;
  onBootstrap?: () => void;
  /** Projects the person HAS (user_projects). Control lists only the ones an
   *  agent can work in — linked to a folder — so "none here" is not "none". */
  registeredCount?: number;
}) {
  // The demo, and anyone whose projects are not linked yet, saw "Add a
  // project" over three projects that Projects listed (owner's walk-through,
  // 2026-10-17). The doc above always said "zero registered projects"; the
  // check counted linked ones.
  if (registeredCount > 0) return <ProjectsNotLinked count={registeredCount} />;
  return (
    <>
      {/* "We already know your work" — two parallel one-click bulk
          imports. GitHub suggestions render for users with a GitHub
          OAuth account linked; LocalDevSuggestions renders inside Fleet
          Runner when ~/dev has git repos. Either or both can be empty
          (collapses to nothing) so the welcome cards still anchor the
          empty state for users without either signal. */}
      <GitHubRepoSuggestions />
      <LocalDevSuggestions />
      <EmptyStateWelcome onAddManual={onAddManual} onBootstrap={onBootstrap} />
    </>
  );
}

function ProjectsNotLinked({ count }: { count: number }) {
  // Empty is quiet (design reset, rule 10): an icon, one line, one button. It
  // was a raised card with a page-sized heading, an explanation and a black
  // button — the second primary on a screen that already had one.
  const which = count === 1 ? "Your project isn't" : `None of your ${count} projects is`;
  return (
    <EmptyState
      icon={FolderGit2}
      title={`${which} connected to its code yet`}
      action={
        <Link href="/projects" className="ui-btn-secondary inline-flex items-center gap-2">
          Open your projects
        </Link>
      }
    />
  );
}

/**
 * Workspaces panel — collapsed by default. Projects already shows per-project
 * state; auto-opening this duplicated the same facts in a second layout
 * (dogfood: read as broken / demo chrome). Open when you need quick-send or
 * peek — not on every Control visit.
 */
export function WorkspacesSection({
  detailsRef,
  tabCount,
  runnerNeverSeen,
  runnerSyncStale,
  children,
}: {
  detailsRef: RefObject<HTMLDetailsElement | null>;
  tabCount: number;
  runnerNeverSeen: boolean;
  runnerSyncStale: boolean;
  children: ReactNode;
}) {
  const plural = `${tabCount} tab${tabCount === 1 ? "" : "s"}`;
  return (
    <details ref={detailsRef} className="ui-control-live-details">
      <summary className="ui-control-live-details-summary">
        <span>Workspaces</span>
        <span className="ui-tag ui-tag-neutral text-micro">
          {runnerNeverSeen ? "offline" : runnerSyncStale ? `${plural} · sync stale` : plural}
        </span>
      </summary>
      <div className="ui-control-live-details-body">{children}</div>
    </details>
  );
}

/**
 * The agent/model defaults used for new launches, as a section of Control's
 * settings sheet. It was a card of its own at the foot of the page, under the
 * builder line that already offered Settings — the one thing below the page's
 * last word (owner, 2026-10-18).
 */
export function LaunchDefaults(props: ComponentProps<typeof BrainConfigPanel>) {
  return (
    // BrainConfigPanel carries its own label ("Default agent for new
    // launches"); a sheet heading above it said the same thing twice.
    <section className="ui-sheet-section">
      <BrainConfigPanel {...props} />
    </section>
  );
}

/** The page's one toast slot: an agent switch beats a queued-dispatch notice. */
export function ControlNotices({
  error,
  queuedNotice,
  switchNotice,
}: {
  error: string | null;
  queuedNotice: string | null;
  switchNotice: string | null;
}) {
  return (
    <>
      {error && <p className="ui-box-error">{error}</p>}
      {(queuedNotice || switchNotice) && (
        <div className="ui-control-notice">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          {switchNotice ?? queuedNotice}
        </div>
      )}
    </>
  );
}
