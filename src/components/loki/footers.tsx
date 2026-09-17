"use client";

/**
 * The blocks that hang under an assistant turn: what a dispatch actually did,
 * what landed in the approval queue, and the one-tap project pick a command
 * needs before it can run.
 *
 * Extracted verbatim from the old Transcript when the chat surface was rebuilt.
 * None of it changed: this is the honest-status logic (a 0-of-3 fan-out must
 * not read like a 3-of-3 success; a question that arrived without a project is
 * still a question) and rewriting it to move it would have risked exactly the
 * regressions its comments were written to prevent.
 */
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, ListChecks, MessageCircle, Monitor, TerminalSquare } from "lucide-react";
import type { CitationMap } from "@/components/ui/markdown-text";
import {
  deriveMultiDispatchView,
  dispatchStatusLabel,
  dispatchToneDotClass,
  type MultiDispatchAttempt,
} from "@/lib/dispatch-status";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import { isBuilderChannel } from "@/lib/constants/statuses";
/** Human-readable label for an assistant turn's kind badge. SSOT for the
 *  small set of kinds the messages route emits. */
export const KIND_LABEL: Record<string, string> = {
  dispatch: "Dispatched",
  chat: "Loki",
  command: "Needs project",
};

/** Outcome footer under a dispatch bubble — tells the operator whether the work
 *  is running, queued, or stuck (runner offline), and links into Control to
 *  watch it. Reads the meta the messages route stamps on dispatch turns. */
/**
 * Build the citation resolver for one message from its persisted meta.
 *
 * Defensive by design: meta is opaque JSON that predates this field, so every
 * older message has no `sources` and must render cleanly rather than showing
 * bare handles. Returning undefined makes MarkdownText drop the markers.
 */
export function citationsFrom(meta: Record<string, unknown> | null): CitationMap | undefined {
  const raw = meta?.sources;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const map: CitationMap = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, label, detail } = entry as { id?: unknown; label?: unknown; detail?: unknown };
    if (typeof id === "string" && typeof label === "string") {
      map[id] = { label, detail: typeof detail === "string" ? detail : "" };
    }
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

export function DispatchFooter({ meta }: { meta: Record<string, unknown> | null }) {
  // Hook first — before any early return — to satisfy rules-of-hooks. commandId
  // is read defensively so it's safe even when meta is null.
  const commandId = typeof meta?.commandId === "string" ? meta.commandId : null;
  const runId = typeof meta?.runId === "string" ? meta.runId : null;
  const live = useDispatchLiveStatus(commandId, runId);
  if (!meta) return null;

  // Fan-out dispatch ("develop these 3 projects") has no single commandId to
  // poll — it has N real outcomes already settled by the time this message was
  // written. Those outcomes used to be thrown away here: the badge fell through
  // to the generic always-green "Dispatched" regardless of how many of the N
  // actually started, so a 0-of-3 failure and a 3-of-3 success read identically
  // at a glance. deriveMultiDispatchView reads the real attempts instead.
  const isMultiDispatch = meta.multiDispatch === true && Array.isArray(meta.attempts);
  const attempts: MultiDispatchAttempt[] = isMultiDispatch
    ? (meta.attempts as unknown[]).filter((a): a is MultiDispatchAttempt => {
        const r = a as Record<string, unknown> | null;
        return !!r && typeof r.projectKey === "string" && typeof r.ok === "boolean";
      })
    : [];
  const multiView = isMultiDispatch ? deriveMultiDispatchView(attempts) : null;

  const projectKey = typeof meta.projectKey === "string" ? meta.projectKey : null;
  const projectKeys = projectKey
    ? [projectKey]
    : Array.isArray(meta.projectKeys)
      ? meta.projectKeys.filter((v): v is string => typeof v === "string")
      : [];
  // A multi-dispatch link points at a project that actually started, never at
  // "whichever was selected first" — the previous behaviour could link a
  // failed dispatch's Control/Terminal buttons at a project that was SKIPPED.
  const primaryProject = multiView ? multiView.primaryProject : (projectKeys[0] ?? null);
  const failed = meta.ok === false;
  const runnerConnected = typeof meta.runnerConnected === "boolean" ? meta.runnerConnected : null;
  const { label: staticStatus, warn } = dispatchStatusLabel({
    ok: failed ? false : true,
    mode: typeof meta.mode === "string" ? meta.mode : null,
    warning: typeof meta.warning === "string" ? meta.warning : null,
    runnerConnected,
    // Messages written before routing was recorded have no channel; those keep
    // the unnamed copy rather than being attributed to a guessed machine.
    channel: isBuilderChannel(meta.channel) ? meta.channel : null,
  });
  // Precedence: real fan-out outcome > live single-command poll > the frozen
  // snapshot from dispatch time.
  const status = multiView ? multiView.label : live ? live.label : staticStatus;
  const dotClass = multiView
    ? dispatchToneDotClass(multiView.tone)
    : live
      ? dispatchToneDotClass(live.tone)
      : warn
        ? "ui-dot-warning"
        : "ui-dot-positive";
  // Only present when the operator pinned a non-default model in the composer.
  const agent = typeof meta.agent === "string" ? meta.agent : null;
  const model = typeof meta.model === "string" ? meta.model : null;
  const pinned = agent ? `${agent}${model ? ` · ${model}` : ""}` : null;
  const targetLabel =
    projectKeys.length === 0
      ? "No project target"
      : projectKeys.length === 1
        ? projectKeys[0]
        : `${projectKeys.length} projects`;
  return (
    <div className="ui-loki-dispatch-card">
      <div className="ui-loki-dispatch-status">
        <span className={dotClass} />
        <span className="font-medium text-text-primary">{status}</span>
        {live?.detail && <span className="text-text-tertiary">{live.detail}</span>}
        <span className="text-text-tertiary">Target: {targetLabel}</span>
        {pinned && <span className="text-text-tertiary">Agent: {pinned}</span>}
      </div>
      {primaryProject && (
        <div className="ui-loki-dispatch-actions">
          <Link
            href={`/control?focus=${encodeURIComponent(primaryProject)}`}
            className="ui-dispatch-watch-link"
          >
            <Monitor className="h-3.5 w-3.5" />
            Control state
          </Link>
          <Link
            href={`/terminal?project=${encodeURIComponent(primaryProject)}`}
            className="ui-dispatch-watch-link"
          >
            <TerminalSquare className="h-3.5 w-3.5" />
            Cloud terminal
          </Link>
          <Link
            href={`/terminal?source=machine&tab=${encodeURIComponent(primaryProject)}`}
            className="ui-dispatch-watch-link"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            This computer
          </Link>
          {projectKeys.length > 1 && (
            <Link href="/control" className="ui-dispatch-watch-link">
              <Monitor className="h-3.5 w-3.5" />
              All selected
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Footer when a chat turn turned into a real action.
 *
 * Two outcomes, two sentences, and the difference is not cosmetic. Under a
 * standing approval the action is ALREADY RUNNING, and the old copy — "added
 * to your approval queue, review to run it" — would send the operator to a
 * queue that no longer holds it, to approve something already approved. That
 * is the same class of untruth as claiming a booking that never happened, just
 * pointing the other way.
 */
export function QueuedActionFooter({ meta }: { meta: Record<string, unknown> | null }) {
  const id = typeof meta?.queuedActionId === "string" ? meta.queuedActionId : null;
  if (!id) return null;
  const title = typeof meta?.queuedActionTitle === "string" ? meta.queuedActionTitle : "an action";
  const auto = meta?.queuedActionAutoApproved === true;
  return (
    <Link href={auto ? "/approvals" : "/today#actions"} className="ui-loki-queued-action">
      <ListChecks className="h-3.5 w-3.5" />
      {auto ? (
        <span>
          Doing it now: <strong>{title}</strong> — your standing approval covers this
        </span>
      ) : (
        <span>
          Added to your approval queue: <strong>{title}</strong> — review to run it
        </span>
      )}
    </Link>
  );
}

/** How many projects can sit in the chip grid before it needs a filter. Nine
 *  chips fill a phone screen; past that, scanning beats reading. */
const PICKER_FILTER_THRESHOLD = 8;

/**
 * One-tap project pick when a command needs a target project.
 *
 * Two things this must never be: a wall of chips with no way through, and a
 * dead end. A question that arrived without a project is still a question —
 * "Just answer" re-sends the same text as chat, so the operator is never
 * forced to name a project in order to be spoken to.
 */
export function NeedsProjectPicker({
  meta,
  onPick,
  onAnswerAnyway,
}: {
  meta: Record<string, unknown> | null;
  onPick: (project: string, pendingText: string) => void;
  onAnswerAnyway?: (pendingText: string) => void;
}) {
  const [query, setQuery] = useState("");
  const pendingText = typeof meta?.pendingText === "string" ? meta.pendingText : "";
  const options = Array.isArray(meta?.projectOptions)
    ? meta.projectOptions.filter((v): v is string => typeof v === "string")
    : [];
  if (!meta?.needsProject) return null;
  if (!pendingText || options.length === 0) return null;

  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((name) => name.toLowerCase().includes(needle)) : options;

  return (
    <div className="ui-loki-picker">
      {options.length > PICKER_FILTER_THRESHOLD && (
        <input
          className="ui-input-compact w-full"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${options.length} projects…`}
          aria-label="Filter projects"
        />
      )}
      <div className="ui-loki-picker-grid">
        {shown.map((name) => (
          <button
            key={name}
            type="button"
            className="ui-loki-picker-chip"
            onClick={() => onPick(name, pendingText)}
          >
            {name}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="text-xs text-text-muted">No project matches “{query}”.</p>
        )}
      </div>
      {onAnswerAnyway && (
        <button
          type="button"
          className="ui-loki-picker-answer"
          onClick={() => onAnswerAnyway(pendingText)}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Just answer — don’t run anything
        </button>
      )}
    </div>
  );
}
