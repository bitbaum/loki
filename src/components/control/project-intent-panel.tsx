"use client";

import { useState, useCallback } from "react";
import { ChevronDown, ChevronUp, Eraser, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMicComposer } from "@/hooks/use-mic-composer";
import { postJson } from "@/lib/api/fetch";
import { PRIMARY_INTENTS, ACTION_INTENTS, MORE_INTENTS } from "@/config/control-intents";
import { PASTE_FROM_HISTORY_TITLE } from "@/config/control-labels";
import { APP_NAME } from "@/config/brand";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { deriveExecutorHonestyLabel } from "@/lib/executor-honesty";
import { ExecutorHonestyChip } from "@/components/executor/ExecutorHonestyChip";
import { useBuilderPresence } from "@/hooks/use-builder-presence";
import type { OrchestrationTaskIntentId } from "@/lib/orchestration";
import type { ProjectState } from "@/lib/control-types";
import { PromptInput } from "./prompt-input";
import { useAttachments } from "@/hooks/use-attachments";
import type { Attachment } from "@/lib/loki/attachments";
import { HostedDispatchButton } from "./HostedDispatchButton";
import { QueueList } from "./queue-list";
import { ProjectPromptLibrary } from "./ProjectPromptLibrary";
import { haptic } from "@/lib/haptics";
import { stripHarnessScaffolding } from "@/lib/activity-status";

/** "Paste from history" chip row — rendered in both the running and idle
 *  branches of IntentButtonPanel; extracted so the two stay identical.
 *  Only shows with 2+ useful items to avoid a third competing list
 *  (Recent dispatches / Paste from history / Prompt library) crowding the card. */
/** How much of a prompt a chip shows. Long enough to recognise one you wrote,
 *  short enough that three fit without becoming the card. */
const DISPLAY_CHARS = 60;
/** Five rows of clipped grey text read as noise on a phone — this is a
 *  convenience, and a convenience does not get to be the tallest thing in the
 *  card. Three is enough to catch "the one I keep retyping". */
const MAX_HISTORY_CHIPS = 3;
function RecentPromptChips({
  prompts,
  onPick,
}: {
  prompts: { customPrompt: string; count: number }[];
  onPick: (text: string) => void;
}) {
  // Dedupe by what the row will actually SAY, not by what it stores.
  //
  // The list was already deduped by full text, which is the wrong key when the
  // display is truncated: two long prompts that differ only past character 60
  // are distinct entries and identical rows. On 2026-08-26 this rendered as two
  // adjacent, pixel-identical "You are reviewing a git diff before push. Be
  // BRIEF (" chips — a list that appears to be malfunctioning. If two rows read
  // the same they ARE the same as far as choosing between them goes, so the
  // busier one wins and the other is dropped.
  const seen = new Map<string, { customPrompt: string; count: number; label: string }>();
  for (const r of prompts) {
    const text = r.customPrompt.replace(/\s+/g, " ").trim();
    const label = text.length > DISPLAY_CHARS ? text.slice(0, DISPLAY_CHARS) + "…" : text;
    const prior = seen.get(label);
    if (!prior || r.count > prior.count) seen.set(label, { ...r, label });
  }
  const rows = [...seen.values()].slice(0, MAX_HISTORY_CHIPS);
  if (rows.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <p className="ui-kicker">{PASTE_FROM_HISTORY_TITLE}</p>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <button
            key={r.label}
            onClick={() => onPick(r.customPrompt)}
            title={`Reuse this prompt: ${r.customPrompt}`}
            className="ui-chip-truncate-label"
          >
            {r.count > 1 && <span className="mr-1.5">used {r.count}×</span>}
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function IntentButtonPanel({
  project,
  currentAdapter,
  isRunning,
  autoContinueEnabled,
  sending,
  justSent,
  sendError,
  onClearSendError,
  custom,
  queue = [],
  queueBlockedReason,
  bannerActive,
  merging,
  onToggleAutoContinue,
  onSendIntent,
  onSendCustom,
  onEnqueueCustom,
  onSendFromQueue,
  onRemoveFromQueue,
  onReorderInQueue,
  onEditInQueue,
  onMergeQueue,
  onMergeItemsInQueue,
  onSendText,
  onCustomChange,
  onCustomFocusChange,
  runtimeAvailable = true,
  runtimeStateKnown = true,
  runnerSyncStale = false,
  automationStatusLabel,
}: {
  project: ProjectState;
  currentAdapter: string;
  isRunning: boolean;
  autoContinueEnabled: boolean;
  sending: string | null;
  /** Transient "✓ Queued" confirmation. Set on confirmed-successful
   *  send; consumers render the ✓ glyph on the matching button until the
   *  hook auto-clears it. UX audit gap: post-200 silence on every dispatch
   *  read as "did it actually do anything?" — this closes the loop. */
  justSent?: { id: string; at: number } | null;
  /** Inline error from the last sendCustom/sendText/sendIntent attempt — surfaced near the send button. */
  sendError?: string | null;
  /** Dismiss the inline error (called from the dismiss button on PromptInput). */
  onClearSendError?: () => void;
  custom: string;
  queue?: string[];
  queueBlockedReason?: string | null;
  bannerActive?: boolean;
  merging?: boolean;
  onToggleAutoContinue?: () => void;
  onSendIntent: (intent: OrchestrationTaskIntentId) => void;
  onSendCustom: (attachments?: Attachment[]) => void;
  onEnqueueCustom?: (prompt: string) => void;
  onSendFromQueue?: (index: number) => void;
  onRemoveFromQueue?: (index: number) => void;
  onReorderInQueue?: (from: number, to: number) => void;
  onEditInQueue?: (index: number, text: string) => void;
  onMergeQueue?: () => void;
  onMergeItemsInQueue?: (indices: number[]) => void;
  // Direct-text send used when recording stops: bypasses stale `custom` state
  onSendText?: (text: string) => void;
  onCustomChange: (value: string) => void;
  onCustomFocusChange: (focused: boolean) => void;
  /** False on the cloud app — gates buttons whose endpoints require the
   *  local runtime (owned agent PTYs) and would 503 silently otherwise. */
  runtimeAvailable?: boolean;
  /** False when cached runner-driven runtime fields cannot be trusted. */
  runtimeStateKnown?: boolean;
  runnerSyncStale?: boolean;
  automationStatusLabel?: string;
}) {
  const [showMore, setShowMore] = useState(false);
  const [showLibraryPrompts, setShowLibraryPrompts] = useState(false);
  // Phone-only: the two reuse surfaces at the foot of this panel share one
  // disclosure. Closed by default — a convenience does not get to open itself
  // on the screen where space is scarcest.
  const [reuseOpen, setReuseOpen] = useState(false);
  const [clearingContext, setClearingContext] = useState(false);
  const builderPresence = useBuilderPresence();
  const dispatchHonesty = deriveExecutorHonestyLabel({
    runnerConnected: builderPresence.runnerConnected,
    runtimeAvailable: runtimeAvailable || builderPresence.runtimeAvailable,
    presence: builderPresence.builderPresence,
  });

  const {
    listening,
    processing,
    micError,
    toggleMic,
    waveformBars,
    recordingSeconds,
    maxRecordingSeconds,
    wrapSend,
    wrapEnqueue,
  } = useMicComposer({
    custom,
    onAppend: onCustomChange,
    onSendAfterRecording: (text) => {
      if (onSendText && text) {
        onSendText(text);
        onCustomChange("");
      }
    },
    onEnqueueAfterRecording: (text) => {
      if (onEnqueueCustom) {
        onEnqueueCustom(text);
        onCustomChange("");
      }
    },
  });

  // The controller lives here, beside the mic, because both are ways of saying
  // the same thing: this is what I want done. Cleared only after a send is
  // handed off, so a failed dispatch keeps the screenshot with the draft.
  const attachments = useAttachments();
  const handleSendCustom = useCallback(
    () =>
      wrapSend(() => {
        haptic();
        onSendCustom(attachments.attachments.length ? attachments.toWire() : undefined);
        attachments.clear();
      }),
    [wrapSend, onSendCustom, attachments],
  );
  const handleEnqueue = useCallback(
    () =>
      wrapEnqueue(() => {
        if (custom.trim() && onEnqueueCustom) {
          haptic();
          onEnqueueCustom(custom.trim());
          onCustomChange("");
        }
      }),
    [wrapEnqueue, custom, onEnqueueCustom, onCustomChange],
  );
  const handleSendIntent = useCallback(
    (id: OrchestrationTaskIntentId) => {
      haptic();
      onSendIntent(id);
    },
    [onSendIntent],
  );

  const inputProps = {
    custom,
    listening,
    processing,
    micError,
    sending,
    justSent,
    waveformBars,
    recordingSeconds,
    maxRecordingSeconds,
    sendError,
    onClearSendError,
    onCustomChange,
    onCustomFocusChange,
    toggleMic,
    showQueue: !!onEnqueueCustom,
    onSendCustom: handleSendCustom,
    onEnqueue: handleEnqueue,
    attachments,
    autoContinueEnabled,
    onToggleAutoContinue,
    // Short inline hint only — the full offline explanation + how-to-reconnect
    // lives once in RunnerStatusBanner. Here we just flag that this composer's
    // sends will queue, without re-stating the banner's sentence.
    statusLabel: !runtimeStateKnown
      ? EXECUTOR_COPY.queuedWhenOffline
      : runnerSyncStale
        ? "Sync stale — sends queue."
        : automationStatusLabel
          ? automationStatusLabel
          : autoContinueEnabled
            ? `Automatic continuation allowed for this project: ${APP_NAME} may send queued work when the agent waits.`
            : `Manual for this project: ${APP_NAME} will wait for you before sending more work.`,
  };

  // Strip the harness envelope (<task-notification>/<system-reminder>/…) BEFORE
  // filtering and display — a reuse chip exists to replay human intent, so a
  // dispatch captured as pure scaffolding (e.g. a task-completion notification
  // recorded as a custom prompt) has nothing to reuse and is dropped. Cleaned
  // variants of the same intent collapse into one chip with summed counts, in
  // original recency order (Map preserves insertion order). SSOT: the same
  // stripHarnessScaffolding the Activity feed uses.
  const cleanedCounts = new Map<string, number>();
  for (const r of project.recentCustomPrompts) {
    const clean = stripHarnessScaffolding(r.customPrompt).replace(/\s+/g, " ").trim();
    if (!clean) continue; // pure harness scaffolding — nothing to reuse
    const t = clean.toLowerCase();
    // Hide meta LOOP / autopilot template prompts from the "Reuse recent" chips.
    // These pollute history (the "Setup (run, read outputs)..." ones the user sees).
    if (t.startsWith("setup (run, read outputs)")) continue;
    if (t.includes("picked ") && t.includes(" (t")) continue; // the accountability line
    if (/\bwaiting for instructions\b/.test(t)) continue;
    // Nav / marketing chrome accidentally captured as "prompts" — not reusable intent.
    if (
      /\b(features|how it works|pricing|for pros|adopt|sign in|log in)\b/.test(t) &&
      t.length < 120
    )
      continue;
    if (/^used \d+×/.test(t)) continue;
    cleanedCounts.set(clean, (cleanedCounts.get(clean) ?? 0) + r.count);
  }
  const recentPrompts = [...cleanedCounts.entries()]
    .map(([customPrompt, count]) => ({ customPrompt, count }))
    .slice(0, isRunning ? 3 : 5);

  // Unified layout for every state (running + idle). Per the user's 2026-06-15
  // decision, a running card keeps full parity with an idle one — Prompt
  // library + intent chips stay available while an agent works — so the card
  // no longer visually collapses into an interrupt-only stub mid-run (which
  // read as "the card is broken / where did my prompt library go?"). Only the
  // composer placeholder changes: while running, a send interrupts the
  // in-flight agent rather than starting fresh work.
  const [primary] = PRIMARY_INTENTS; // next_best is always first

  return (
    <div className="space-y-3 ui-card-section">
      <PromptInput
        {...inputProps}
        placeholder={isRunning ? "Send interrupt…" : "What should the agent work on?"}
      />
      {queue.length > 0 && (
        <QueueList
          queue={queue}
          blockedReason={queueBlockedReason}
          onSend={onSendFromQueue}
          onRemove={onRemoveFromQueue}
          onReorder={onReorderInQueue}
          onEdit={onEditInQueue}
          onMerge={onMergeQueue}
          merging={merging}
          onMergeItems={onMergeItemsInQueue}
        />
      )}

      {/* Action area — hidden when banner is active (banner owns the primary CTA) */}
      {!bannerActive && primary && (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          {/* No "Send to agent" heading here any more.
              The composer sitting directly above already asks the question —
              its placeholder is "What should the agent work on?" — so the
              kicker restated it and, worse, put a section break between the
              two halves of ONE decision. Measured on a phone: the composer
              ended at y=779 and this button started at y=924, reading as a
              separate feature rather than the other way to answer the same
              prompt. The honesty chip stays; it says something the button
              cannot ("Builder online"). */}
          <div className="flex justify-end">
            <ExecutorHonestyChip honesty={dispatchHonesty} />
          </div>
          {/* Primary CTA: Next best — full width, visually elevated.
              Tooltip makes the AI-dispatch nature explicit per the unified
              prompt UX (2026-05-31) — every other prompt-click on /control
              fills the textarea, but this one and the secondary intent chips
              dispatch immediately. Users need to know the difference. */}
          <button
            onClick={() => handleSendIntent(primary.id)}
            disabled={sending !== null}
            title={
              queueBlockedReason
                ? `${queueBlockedReason}: Next best stays on recovery work and will not consume the queue. Use a queue row's send button to run that item now.`
                : "The agent re-reads ground truth (git, types, lint, TODOs, roadmap, session handoff), picks the single highest-impact task, and executes. Dispatches immediately, no preview."
            }
            className="ui-btn-nextbest"
          >
            {sending === primary.id
              ? "…"
              : justSent?.id === primary.id
                ? `✓ Queued`
                : `${primary.label} →`}
          </button>

          {/* Secondary intents: compact chips + More toggle.
              This row used to carry Test & fix / Quality / Commit, hidden under
              `sm` but always shown above it — "the room to show them was never
              the problem" at desktop widths. Room was not the problem; ATTENTION
              was. Counted over all of orchestration_runs, those three have one
              real dispatch between them ever, against next_best's 185, so they
              now live in `more` (see config/control-intents.ts for the counts).
              ACTION_INTENTS is consequently empty and this map renders nothing —
              the group is kept, not deleted, because the fix is a config change
              and reassigning an intent back is one word. */}
          <div className="flex flex-wrap gap-1.5">
            {ACTION_INTENTS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => handleSendIntent(id)}
                disabled={sending !== null}
                className={cn(
                  "ui-chip-action-compact text-text-secondary",
                  !showMore && "hidden sm:inline-flex",
                )}
              >
                {sending === id ? "…" : justSent?.id === id ? "✓" : label}
              </button>
            ))}
            <button
              onClick={() => setShowMore((v) => !v)}
              className="ui-chip-action-compact text-text-muted"
            >
              {showMore ? "↑ Less" : "More"}
            </button>
          </div>

          {/* Expanded: rarely-used intents */}
          {showMore && (
            <div className="flex flex-wrap gap-1.5 border-t border-border-subtle pt-2">
              {MORE_INTENTS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => handleSendIntent(id)}
                  disabled={sending !== null}
                  className="ui-chip-action-compact text-text-tertiary"
                >
                  {sending === id ? "…" : justSent?.id === id ? "✓" : label}
                </button>
              ))}
              {/* Hide on cloud — /api/project/clear-context writes into the
                  local owned PTY and 503s otherwise; the click handler
                  ignored failure so cloud users saw a brief spinner with no
                  feedback. */}
              {(currentAdapter === "claude" || currentAdapter === "grok") && runtimeAvailable && (
                <button
                  onClick={async () => {
                    setClearingContext(true);
                    try {
                      await postJson("/api/project/clear-context", { tab: project.tab });
                    } finally {
                      setClearingContext(false);
                    }
                  }}
                  disabled={clearingContext}
                  title="Send /clear to reset the agent's context window (claude/grok)"
                  className="ui-chip-action-compact inline-flex items-center gap-1.5 text-text-tertiary hover:text-status-warning"
                >
                  {clearingContext ? (
                    <Loader2 className="ui-spinner-sm" />
                  ) : (
                    <Eraser className="h-3.5 w-3.5" />
                  )}
                  Clear context
                </button>
              )}
              {/* Explicit hosted-runner path: works regardless of local-runner
                  state (the composer's Send only auto-routes to Hermes when the
                  runner is OFFLINE). Prefills from the current composer text. */}
              <HostedDispatchButton
                projectTab={project.tab}
                projectName={project.tab}
                initialTask={custom}
              />
            </div>
          )}
        </div>
      )}

      {/* ONE reuse affordance on a phone, not two.
          These two components do the same job with the same handler —
          `onPick={onCustomChange}` and `onSelect={onCustomChange}`, both
          "put text in the composer" — yet they rendered as two separate
          blocks with two headings. Counted on the live detail screen at
          390px, they accounted for 4 of 22 controls and ~150px, below the
          fold, competing with the composer they feed.
          They stay one tap away, together, under a single label. From `lg`
          the toggle is hidden and both are simply visible, as before: the
          desktop card has the room and never had the problem. */}
      <button
        type="button"
        onClick={() => setReuseOpen((v) => !v)}
        aria-expanded={reuseOpen}
        className="ui-btn-ghost ui-btn-xs w-full justify-between lg:hidden"
      >
        Reuse a prompt
        {reuseOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      <div className={cn("space-y-3", !reuseOpen && "max-lg:hidden")}>
        <RecentPromptChips prompts={recentPrompts} onPick={onCustomChange} />

        <ProjectPromptLibrary
          projectName={project.tab}
          open={showLibraryPrompts}
          onOpenChange={setShowLibraryPrompts}
          // Universal fill-first rule (2026-05-31): library picks always go into
          // the composer textarea so the user previews/edits before sending.
          // Previously this branched on bannerActive and silently sent — the
          // same click had different consequences depending on which surface
          // you were on, which was the UX bug the user named.
          onSelect={onCustomChange}
        />
      </div>
    </div>
  );
}
