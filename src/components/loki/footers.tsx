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
import { ArrowRight, CornerDownRight, MessageCircle, Sparkles, TerminalSquare } from "lucide-react";
import { nextStepPrompt, type RunHandoff } from "@/lib/run-handoff";
import type { CitationMap } from "@/components/ui/markdown-text";
import {
  deriveMultiDispatchView,
  dispatchStatusLabel,
  dispatchToneDotClass,
  type MultiDispatchAttempt,
} from "@/lib/dispatch-status";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import { useBuilderPresence } from "@/hooks/use-builder-presence";
import { isDispatchCardAction, presentDispatchCard, watchHref } from "@/lib/dispatch-card";
import { cloudBuilderState } from "@/lib/builder-way-forward";
import { isBuilderChannel } from "@/lib/constants/statuses";
import { postJson } from "@/lib/api/fetch";
import { RunTrack } from "@/components/projects/RunTrack";
import { RunLook } from "@/components/projects/RunLook";
import { rankByQuery, TEXT_SPEC } from "@/lib/search";
/** Human-readable label for an assistant turn's kind badge. SSOT for the
 *  small set of kinds the messages route emits. */
export const KIND_LABEL: Record<string, string> = {
  dispatch: "Dispatched",
  chat: "Loki",
  command: "Needs project",
  outcome: "Update",
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

export function DispatchFooter({
  meta,
  onContinue,
}: {
  meta: Record<string, unknown> | null;
  /** A next step was tapped: send it in this chat, on this project. */
  onContinue?: (text: string, project: string) => void;
}) {
  // Hook first — before any early return — to satisfy rules-of-hooks. commandId
  // is read defensively so it's safe even when meta is null.
  const commandId = typeof meta?.commandId === "string" ? meta.commandId : null;
  const runId = typeof meta?.runId === "string" ? meta.runId : null;
  const live = useDispatchLiveStatus(commandId, runId);
  // Shared poll (one interval for the whole page): what the cloud builder is
  // to this account decides whether a dispatch waiting for "this computer"
  // offers the cloud, or a download.
  const presence = useBuilderPresence();
  const cloud = cloudBuilderState(presence.cloudBuilderAllowed, presence.builderPresence);
  // "Run it in the cloud" retargets the queued row in place (same command id,
  // so the live status keeps polling it). Until the builder claims it, the
  // stored meta still says "local": these two lines are what the card reads
  // in that gap, so it says where the work now is, not where it was.
  const [moved, setMoved] = useState<"idle" | "moving" | "moved">("idle");
  const [moveError, setMoveError] = useState<string | null>(null);
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
  const storedChannel = isBuilderChannel(meta.channel) ? meta.channel : null;
  const channel = moved === "moved" ? "cloud" : storedChannel;
  const reroutedFrom =
    moved === "moved"
      ? storedChannel
      : isBuilderChannel(meta.reroutedFrom)
        ? meta.reroutedFrom
        : null;
  const { label: staticStatus, warn } = dispatchStatusLabel({
    ok: failed ? false : true,
    mode: typeof meta.mode === "string" ? meta.mode : null,
    warning: typeof meta.warning === "string" ? meta.warning : null,
    runnerConnected,
    // Messages written before routing was recorded have no channel; those keep
    // the unnamed copy rather than being attributed to a guessed machine.
    channel,
    reroutedFrom,
  });
  // Only present when the operator pinned a non-default model in the composer.
  const agent = typeof meta.agent === "string" ? meta.agent : null;
  const model = typeof meta.model === "string" ? meta.model : null;
  const pinned = agent ? `${agent}${model ? ` · ${model}` : ""}` : null;

  // A fan-out's real outcome is the headline; its links go to the project
  // that actually started (never one that was skipped).
  const card = multiView
    ? {
        headline: multiView.label,
        detail: null,
        tone: multiView.tone,
        primary: primaryProject
          ? { label: "Watch it", href: watchHref(primaryProject, channel) }
          : null,
        secondary: [{ label: `All ${projectKeys.length} on Home`, href: "/control" }],
      }
    : presentDispatchCard({
        live,
        staticLabel: staticStatus,
        warn: moved === "moved" ? false : warn,
        failed,
        channel,
        project: primaryProject,
        projectCount: projectKeys.length,
        cloud,
      });

  async function runInCloud() {
    if (!commandId) return;
    setMoved("moving");
    setMoveError(null);
    try {
      const res = await postJson("/api/control/reroute", { commandId });
      const body = (await res.json()) as {
        error?: string;
        rerouted?: number;
        skipped?: { reason: string }[];
      };
      if (!res.ok) {
        setMoveError(body.error ?? `Could not move it (HTTP ${res.status})`);
        setMoved("idle");
        return;
      }
      if (!body.rerouted) {
        setMoveError(body.skipped?.[0]?.reason ?? "A runner just picked it up.");
        setMoved("idle");
        return;
      }
      setMoved("moved");
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : "Could not move it");
      setMoved("idle");
    }
  }
  const target = projectKeys.length > 1 ? `${projectKeys.length} projects` : projectKeys[0];
  // The run's own account of itself, once it is over (lib/run-handoff). With
  // it, "successful outcome recorded" is the least useful line on the card.
  const handoff = live?.terminal ? (live.handoff ?? null) : null;
  const detail = handoff?.done.length ? null : card.detail;

  return (
    <div className="ui-loki-dispatch-card">
      <div className="ui-loki-dispatch-status">
        <span className={dispatchToneDotClass(card.tone)} />
        <span className="font-medium text-text-primary">{card.headline}</span>
        {target && <span className="text-text-tertiary">· {target}</span>}
      </div>
      {(detail || pinned) && (
        <p className="ui-loki-dispatch-detail">
          {detail}
          {detail && pinned ? " · " : ""}
          {pinned && `Agent: ${pinned}`}
        </p>
      )}
      {/* Where the change is — the same six stages Watch draws, from the same
          loader, so the chat and the Watch page never tell two stories. A
          settled track folds to its one sentence; a tap opens the road. */}
      {live?.track && (
        <div className="ui-loki-track">
          <RunTrack track={live.track} collapsible />
        </div>
      )}
      {live?.terminal && live.follow && <RunLook follow={live.follow} />}
      {handoff && (
        <RunHandoffBlock
          handoff={handoff}
          onNext={
            onContinue && primaryProject
              ? (step) => onContinue(nextStepPrompt(step), primaryProject)
              : undefined
          }
        />
      )}
      {moveError && <p className="ui-loki-dispatch-detail text-status-warning">{moveError}</p>}
      {(card.primary || card.secondary.length > 0) && (
        <div className="ui-loki-dispatch-actions">
          {card.primary &&
            (isDispatchCardAction(card.primary) ? (
              <button
                type="button"
                onClick={runInCloud}
                disabled={moved === "moving" || !commandId}
                className="ui-dispatch-watch-link ui-dispatch-primary disabled:opacity-50"
              >
                {moved === "moving" ? "Moving…" : card.primary.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : (
              <Link href={card.primary.href} className="ui-dispatch-watch-link ui-dispatch-primary">
                {card.primary.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ))}
          {card.secondary.map((link) => (
            <Link key={link.href} href={link.href} className="ui-loki-dispatch-secondary">
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What the finished run did, what it checked, and what it would do next —
 * said in the chat instead of one link away. Each next step is one tap that
 * carries on here, on the same project; ignoring them costs nothing.
 */
function RunHandoffBlock({
  handoff,
  onNext,
}: {
  handoff: RunHandoff;
  onNext?: (step: string) => void;
}) {
  return (
    <div className="ui-loki-handoff">
      {handoff.done.length > 0 && (
        <div>
          <p className="ui-micro-label">What changed</p>
          <ul className="ui-loki-handoff-list">
            {handoff.done.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {handoff.checked && (
        <p className="ui-loki-dispatch-detail">
          <span className="font-medium text-text-secondary">Checked:</span> {handoff.checked}
        </p>
      )}
      {handoff.next.length > 0 && onNext && (
        <div>
          <p className="ui-micro-label">Next, if you want it</p>
          <ul className="ui-loki-followups" aria-label="Next steps">
            {handoff.next.map((step, i) => (
              <li key={step}>
                <button
                  type="button"
                  className={
                    i === 0 ? "ui-loki-followup ui-loki-followup-next" : "ui-loki-followup"
                  }
                  onClick={() => onNext(step)}
                >
                  <CornerDownRight className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{step}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
  if (!pendingText) return null;
  // No options (e.g. older messages from before the server stopped asking in
  // an empty workspace): still offer the way through, never an empty footer.
  if (options.length === 0 && !onAnswerAnyway) return null;

  // Best match first; one slip in a project's name still finds it.
  const shown = rankByQuery(options, TEXT_SPEC, query);

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
      {options.length > 0 && (
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
      )}
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

/**
 * Under an answer whose message also read like work to do: one quiet line,
 * closed. Tapping it opens the project list; picking one sends the same words
 * to that project. It replaced a turn that stopped and asked "which project?"
 * before answering anything — a form where a reply should have been.
 */
/**
 * Under a turn the person's own model failed: the free chain, for the same
 * words, in one tap. Never automatic — their key failing is the one thing
 * they need to see — but never a dead end either.
 */
export function OwnModelFallbackOffer({
  meta,
  onAnswerFree,
}: {
  meta: Record<string, unknown> | null;
  onAnswerFree: (pendingText: string) => void;
}) {
  if (!meta?.ownModelFailed || typeof meta.pendingText !== "string") return null;
  return (
    <div className="ui-loki-run-offer">
      <button
        type="button"
        className="ui-loki-picker-answer"
        onClick={() => onAnswerFree(meta.pendingText as string)}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Answer with the free models instead
      </button>
    </div>
  );
}

export function RunOnProjectOffer({
  meta,
  onPick,
}: {
  meta: Record<string, unknown> | null;
  onPick: (project: string, pendingText: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!meta?.runOffer || typeof meta.pendingText !== "string") return null;
  const unknown = typeof meta.unknownProject === "string" ? meta.unknownProject : null;
  return (
    <div className="ui-loki-run-offer">
      <button
        type="button"
        className="ui-loki-picker-answer"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />
        {unknown
          ? `No project called “${unknown}” — run this on another…`
          : "Run this on a project…"}
      </button>
      {open && <NeedsProjectPicker meta={{ ...meta, needsProject: true }} onPick={onPick} />}
    </div>
  );
}
