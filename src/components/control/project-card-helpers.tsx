"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { secondsAgo, formatElapsedSeconds } from "@/lib/dates";
import { getIntentLabel, getAdapterLabel } from "@/config/control-intents";
import { formatRunUsage } from "@/lib/usage/format";
import type { ProjectState } from "@/lib/control-types";
import { MINUTE_MS } from "@/lib/constants/time";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { describeRunShipping, shippingLanded } from "@/lib/control-run-shipping";

export function ClosedBanner({
  session,
  onContinue,
  onDismiss,
}: {
  session: ProjectState["session"];
  onContinue: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-4 border-t border-status-positive/20 bg-status-positive/[0.05] px-5 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-status-positive shrink-0" />
        <span className="text-base font-medium text-status-positive">Session closed</span>
      </div>

      {session && (
        <div className="grid gap-3 md:grid-cols-2">
          {session.done && (
            <div className="ui-control-summary-card bg-status-positive/[0.06]">
              <p className="ui-kicker">Agent-reported completed</p>
              <p className="text-base text-text-primary leading-relaxed">{session.done}</p>
            </div>
          )}
          {session.next && (
            <div className="ui-control-summary-card bg-status-positive/[0.03]">
              <p className="ui-kicker">Agent-reported next</p>
              <p className="text-base text-text-secondary leading-relaxed">{session.next}</p>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onContinue}
          className="flex-1 rounded-2xl bg-surface-overlay px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
        >
          Continue →
        </button>
        <button
          onClick={onDismiss}
          className="rounded-2xl px-4 py-3 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

export function ClosingBanner({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="border-t border-status-warning/20 bg-status-warning/[0.04] px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Loader2 className="ui-spinner-sm text-status-warning" />
        <span className="text-sm font-medium text-status-warning">Closing session…</span>
        <span className="ml-auto text-sm text-text-secondary">{secondsAgo(startedAt)} running</span>
      </div>
    </div>
  );
}

export function RunningBanner({
  label,
  promptKey,
  startedAt,
}: {
  label: string;
  promptKey: string;
  startedAt: number;
}) {
  const [elapsed, setElapsed] = useState(() => Math.floor(Date.now() / 1000) - startedAt);
  // Click-to-expand: the prompt label is truncated by default (1 line for
  // canned prompts, 3 lines for custom) so cards stay scannable. The
  // browser title="" tooltip wasn't surfacing long prompts well; clicking
  // the label now toggles full-text display so the user can read what the
  // agent is actually working on without leaving the card.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor(Date.now() / 1000) - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsedStr = formatElapsedSeconds(elapsed);

  const timerClass = elapsed > 900 ? "text-status-warning" : "text-text-muted";
  const isCustom = promptKey === "custom";
  // Short labels ("Direct terminal activity") never truncate, so the toggle
  // flipped more↔less with zero visible change — an inert control. Only offer
  // expansion when the label is long enough to plausibly clamp (1 line for
  // canned prompts, 3 lines for custom).
  const mayTruncate = label.length > (isCustom ? 160 : 48);

  // Truncation classes differ per prompt kind; clearing them when expanded
  // lets the full text render with whitespace preserved.
  const truncatedClass = isCustom
    ? "mt-0.5 line-clamp-3 text-xs leading-relaxed text-text-secondary"
    : "truncate text-sm font-medium text-text-primary";
  const expandedClass = isCustom
    ? "mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-text-secondary"
    : "whitespace-pre-wrap break-words text-sm font-medium text-text-primary";

  return (
    <div className="border-t border-accent-primary/25 bg-accent-primary/[0.05] px-5 py-3.5">
      <div className="flex items-start gap-2.5">
        <Loader2 className="ui-spinner-sm ui-icon-nudge text-accent-text shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-micro font-semibold uppercase tracking-caps text-accent-text/60">
            Working
            {mayTruncate && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-2 text-accent-text/60 hover:text-accent-text underline-offset-2 hover:underline"
                aria-label={expanded ? "Collapse prompt" : "Show full prompt"}
              >
                {expanded ? "less" : "more"}
              </button>
            )}
          </p>
          <p
            className={cn(
              mayTruncate && "cursor-pointer",
              expanded ? expandedClass : truncatedClass,
            )}
            onClick={mayTruncate ? () => setExpanded((v) => !v) : undefined}
            title={mayTruncate ? (expanded ? "Click to collapse" : "Click to expand") : undefined}
          >
            {label}
          </p>
        </div>
        <span className={cn("ui-icon-nudge-p shrink-0 text-xs tabular-nums", timerClass)}>
          {elapsedStr}
        </span>
      </div>
    </div>
  );
}

const RUN_STATE_TAG: Record<string, string> = {
  done: "ui-tag ui-tag-positive",
  error: "ui-tag ui-tag-negative",
  running: "ui-tag ui-tag-warning",
};

// A run row left in "running" with no terminal write (agent crashed / killed
// before the finish hook fired) used to render here as a live-looking
// "running" warning tag for up to an hour. This panel is the "previous"
// (finished) run — a genuinely-live run shows in the project header instead —
// so a "running" row older than this cap is treated as interrupted.
const STALE_RUNNING_MS = 30 * MINUTE_MS;

export function LatestOrchestrationPanel({
  run,
  nowMs,
}: {
  run: NonNullable<ProjectState["latestOrchestrationRun"]>;
  /** Current time in ms, passed from the parent so this render stays pure. */
  nowMs: number;
}) {
  const startedMs = run.startedAt ? Date.parse(run.startedAt) : 0;
  const staleRunning =
    run.state === ORCH_STATE.RUNNING && startedMs > 0 && nowMs - startedMs > STALE_RUNNING_MS;
  const displayState = staleRunning ? "interrupted" : run.state;
  const stateClass = staleRunning
    ? "ui-tag ui-tag-neutral"
    : (RUN_STATE_TAG[run.state] ?? "ui-tag ui-tag-neutral");
  const [expanded, setExpanded] = useState(false);
  const hasSummary = Boolean(run.summary?.done || run.summary?.next);
  const fallbackText = run.payload?.resultText?.trim() ?? "";

  const shorten = (value: string, max = 180) => {
    if (value.length <= max) return value;
    return `${value.slice(0, max).trimEnd()}…`;
  };

  const summaryDone = run.summary?.done?.trim() ?? "";
  const summaryNext = run.summary?.next?.trim() ?? "";
  const resultText = expanded ? fallbackText : shorten(fallbackText, 220);

  // Truthful-state signal: a finished run that claims work done but recorded
  // no commit ("none"/empty) left nothing in git. Surface that gap instead of
  // trusting the self-report — a "done" with no trace is the exact failure
  // mode the control loop must catch.
  const commitRaw = run.summary?.commit?.trim() ?? "";
  const committed = commitRaw && commitRaw.toLowerCase() !== "none";
  // The fix ledger outranks the run's self-report: a merged, deployed pull
  // request proves the work landed even when the handoff recorded no commit.
  // Without this the card printed "no commit" directly beside "merged and
  // deployed".
  const shipping = run.payload?.fix;
  const shippingLine = describeRunShipping(shipping);
  const claimedWorkNoCommit =
    run.state === ORCH_STATE.DONE &&
    summaryDone.length > 0 &&
    !committed &&
    !shippingLanded(shipping);

  // Loop-control truthful state (persisted via the SSOT summary build): a blocked
  // agent isn't failing OR succeeding — it's stuck waiting, and a high no-op count
  // means it's spinning without shipping. Surface both so a "done"-looking card
  // can't hide that the loop actually stalled on a decision or went in circles.
  const blockReason = run.summary?.["block-reason"]?.trim() ?? "";
  const noOpRaw = run.summary?.["no-op-count"]?.trim() ?? "";
  const noOpCount = /^\d+$/.test(noOpRaw) ? parseInt(noOpRaw, 10) : 0;

  return (
    <div className="space-y-2.5 ui-card-section">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="ui-kicker"
          title="Previous automated run. Live terminal state is shown in the project header."
        >
          Previous automated run
        </span>
        <span className="ui-tag ui-tag-neutral">
          {getAdapterLabel(run.adapter)} · {getIntentLabel(run.intent)}
        </span>
        <span className={stateClass}>{displayState}</span>
        {(() => {
          const usageLine = formatRunUsage(run);
          return usageLine ? (
            <span
              className="ui-tag ui-tag-neutral tabular-nums"
              title="Tokens this run consumed (input incl. cache reads → output) · estimated cost at API list rates"
            >
              {usageLine}
            </span>
          ) : null;
        })()}
        {committed && (
          <span className="ui-tag ui-tag-neutral font-mono" title="Commit produced by this run">
            ↪ {commitRaw}
          </span>
        )}
        {claimedWorkNoCommit && (
          <span
            className="ui-tag ui-tag-warning"
            title="Run reported work done but recorded no commit — nothing landed in git."
          >
            no commit
          </span>
        )}
        {shippingLine &&
          (shipping?.prUrl ? (
            <a
              href={shipping.prUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "ui-tag",
                shippingLanded(shipping) ? "ui-tag-positive" : "ui-tag-neutral",
              )}
              title="Where this run's change got to after the run closed. The state above grades the attempt; this grades the change."
            >
              {shippingLine}
            </a>
          ) : (
            <span
              className={cn(
                "ui-tag",
                shippingLanded(shipping) ? "ui-tag-positive" : "ui-tag-neutral",
              )}
              title="Where this run's change got to after the run closed. The state above grades the attempt; this grades the change."
            >
              {shippingLine}
            </span>
          ))}
        {blockReason && (
          <span
            className="ui-tag ui-tag-warning"
            title="Agent reported it is blocked and can't progress without input."
          >
            blocked: {blockReason.replace(/_/g, " ")}
          </span>
        )}
        {noOpCount >= 3 && (
          <span
            className="ui-tag ui-tag-warning"
            title="Consecutive no-op turns — the agent is looping without shipping."
          >
            {noOpCount} no-ops
          </span>
        )}
      </div>

      {summaryNext && (
        <div className="space-y-1">
          <p className="ui-kicker">next</p>
          <p className="text-sm leading-snug text-text-primary">{summaryNext}</p>
        </div>
      )}

      {summaryDone && (
        <div className="space-y-1">
          <p className="ui-kicker">completed</p>
          <p className="text-sm leading-relaxed text-text-secondary">{summaryDone}</p>
        </div>
      )}

      {!hasSummary && fallbackText && (
        <div className="space-y-1">
          <p className="ui-kicker">result</p>
          <p className="text-sm leading-relaxed text-text-secondary">{resultText}</p>
          {fallbackText.length > 220 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="ui-link-subtle text-xs"
            >
              {expanded ? "Show less" : "Show full result"}
            </button>
          )}
        </div>
      )}

      {/* payload.error renders ONLY for a run that actually failed.
          Every writer of that field sets state = error alongside it
          (closeRunUndelivered, and the reaper's timeout branch), so an error
          sitting on a non-failed run is stale data by construction: the
          pre-2026-08-26 reaper wrote its correction prose there, and rows
          already in the database still carry sentences like "Reaped as
          timeout ... corrected to partial (see evidence)". Restyling them
          was not enough — the text itself is reaper vocabulary addressed to
          nobody. A non-failed run says what it has to say through `note`. */}
      {run.payload?.error && run.state === ORCH_STATE.ERROR && (
        <p className="ui-error">{run.payload.error}</p>
      )}

      {run.payload?.note && (
        <p className="text-xs leading-relaxed text-text-muted">
          {run.payload.note}
          {run.payload.evidence && (
            <>
              {" "}
              <a
                href={run.payload.evidence.url}
                target="_blank"
                rel="noreferrer"
                className="ui-link-subtle"
                title={run.payload.evidence.title}
              >
                {run.payload.evidence.kind === "pr" ? "See the pull request" : "See the push"}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
