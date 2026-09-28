"use client";

import Link from "next/link";
import { Check, Loader2, SearchX } from "lucide-react";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { useKickoffRunForTab, type KickoffRun } from "@/lib/kickoff-run";
import { KICKOFF_STEP_LABEL } from "@/lib/project-kickoff";

/**
 * What a ?tab= deep link that matched nothing gets instead of somebody else's
 * session.
 *
 * The old behaviour was a one-line warning above a live terminal already
 * attached to `tabs[0]`, with the mode bar underneath it still reading
 * "Keystrokes go straight to the session. Ctrl-C, arrows and paste all work."
 * Observed on a phone 2026-08-18: a Loki dispatch link for `orangecat` landed
 * on `sbb-lost-found` and said so in small orange text three rows above the
 * cursor. Everything the operator typed — including Ctrl-C — would have gone
 * into an unrelated agent's session.
 *
 * A miss is a decision point, not a notice. Nothing is attached until the
 * operator picks, and the alternatives are named rather than assumed.
 */
export function TerminalSessionMiss({
  requestedTab,
  sourceLabel,
  otherSourceLabel,
  available,
  onAttach,
  onSwitchSource,
}: {
  requestedTab: string;
  /** Where we looked — "Cloud" / "This computer". */
  sourceLabel: string;
  /** The one place we haven't looked, offered as the next thing to try. */
  otherSourceLabel: string | null;
  available: string[];
  onAttach: (tab: string) => void;
  onSwitchSource: () => void;
}) {
  // Someone who pressed "Make it happen" and came here to watch is not looking
  // for a session by name — they are asking "is it starting?". Answer that.
  const kickoff = useKickoffRunForTab(requestedTab);
  if (kickoff && kickoff.dispatch !== "running") {
    return <KickoffInProgress run={kickoff} tab={requestedTab} />;
  }

  return (
    <div className="ui-term-miss">
      <SearchX className="h-6 w-6 text-status-warning" aria-hidden="true" />
      <p className="ui-term-miss-title">
        No session named “{requestedTab}” on {sourceLabel}
      </p>
      <p className="ui-term-miss-body">
        Nothing is attached yet. This page shows agent sessions started by Loki builders. If you
        just dispatched work, check its status in Control; a session appears here when the selected
        builder starts it. Choose another running session only if you mean to type there.
      </p>

      {available.length > 0 && (
        <div className="ui-term-miss-options">
          <span className="ui-micro-label">Running on {sourceLabel}</span>
          <div className="ui-term-miss-grid">
            {available.map((tab) => (
              <button
                key={tab}
                type="button"
                className="ui-term-miss-chip"
                onClick={() => onAttach(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ui-term-miss-actions">
        {otherSourceLabel && (
          <button type="button" className="ui-btn-secondary" onClick={onSwitchSource}>
            Look on {otherSourceLabel}
          </button>
        )}
        <Link
          href={`/loki?project=${encodeURIComponent(requestedTab)}`}
          className="ui-btn-secondary"
        >
          Start “{requestedTab}” from Loki
        </Link>
      </div>
    </div>
  );
}

/**
 * The Terminal slot while a project is still being set up (or waiting for a
 * builder): the same steps the project page shows, live, and where to go next.
 */
function KickoffInProgress({ run, tab }: { run: KickoffRun; tab: string }) {
  const current = run.steps.find((s) => s.state === "running");
  let title: string;
  let body: string;
  if (run.running) {
    title = `Setting up “${tab}”`;
    body = current
      ? `${KICKOFF_STEP_LABEL[current.id]}… The agent's session opens here as soon as setup finishes.`
      : "The agent's session opens here as soon as setup finishes.";
  } else if (run.dispatch === "queued-offline") {
    title = "Queued — waiting for a builder";
    body =
      "Setup is done and the work is saved. No builder is connected right now, so the session opens here the moment one comes online.";
  } else {
    title = "The agent has not been started";
    body = run.interrupted
      ? "Loki restarted mid-setup. Everything done so far is saved — open the project to pick up where it left off."
      : "A setup step did not complete. The project page says which one and has Try again.";
  }

  return (
    <div className="ui-term-miss" aria-live="polite">
      {run.running ? (
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" aria-hidden="true" />
      ) : (
        <SearchX className="h-6 w-6 text-status-warning" aria-hidden="true" />
      )}
      <p className="ui-term-miss-title">{title}</p>
      <p className="ui-term-miss-body max-w-md">{body}</p>
      <ol className="mt-2 w-full max-w-xs space-y-1.5 text-left">
        {run.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-xs">
            {s.state === "running" ? (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-text"
                aria-hidden="true"
              />
            ) : s.state === "done" ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-status-positive" aria-hidden="true" />
            ) : (
              <span
                className={`ui-dot mx-1 shrink-0 ${s.state === "failed" ? "ui-dot-negative" : "ui-dot-neutral"}`}
                aria-hidden="true"
              />
            )}
            <span className={s.state === "pending" ? "text-text-tertiary" : "text-text-secondary"}>
              {KICKOFF_STEP_LABEL[s.id]}
            </span>
          </li>
        ))}
      </ol>
      <div className="ui-term-miss-actions">
        <Link href={fleetSurfaceHref("profile", tab)} className="ui-btn-secondary">
          Open the project
        </Link>
        {run.dispatch === "queued-offline" && (
          <Link href="/download" className="ui-btn-secondary">
            Connect your computer
          </Link>
        )}
      </div>
    </div>
  );
}
