"use client";

import { Settings2, Sparkles } from "lucide-react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { APP_NAME } from "@/config/brand";
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
}: {
  onAddManual: () => void;
  onBootstrap?: () => void;
}) {
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
 * The agent/model defaults used for new launches. The old "Diagnostics and
 * launch settings" label promised diagnostics it never contained, and the
 * panel carried a second "New project" button no one could find down here —
 * the header's "+ New" is the one CTA for that.
 */
export function LaunchDefaultsSection(props: ComponentProps<typeof BrainConfigPanel>) {
  return (
    <details className="ui-control-launch-defaults">
      <summary className="ui-control-launch-defaults-summary flex items-center gap-2">
        <Settings2 className="h-3.5 w-3.5" />
        Launch defaults
      </summary>
      <div className="ui-control-launch-defaults-body space-y-5">
        <section>
          <p className="mb-3 text-xs leading-relaxed text-text-tertiary">
            These choices are used when {APP_NAME} opens a new terminal tab. CLI availability is
            reported by the connected computer, not by the cloud.
          </p>
          <BrainConfigPanel {...props} />
        </section>
      </div>
    </details>
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
