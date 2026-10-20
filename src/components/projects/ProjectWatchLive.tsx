"use client";

/**
 * THE card at the top of Watch — one card for the run's whole life, so the
 * page never jumps between a "live" card and a "finished" card: waiting for
 * a builder → the agent working (Loki narrating, the story so far, the box
 * that steers it, the autopilot switch) → the change on its way through
 * merge and deploy → live, with the engineer's walkthrough of what changed.
 * Same element, same key; only its contents move (owner, 2026-10-17:
 * "smooth movement between different screens and the user never wonders
 * what's going on").
 *
 * Narration: hooks/use-watch-narration over lib/watch-narration. Until the
 * first narration lands, the headline is the agent's own current step from
 * the screen, so the card never opens empty. Under the headline, the
 * delivery track (lib/run-track) says what has actually happened.
 */

import { useProjectAutopilot } from "@/hooks/use-project-autopilot";
import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUp, ArrowUpRight, Check, Loader2, Sparkles } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { timeAgo } from "@/lib/dates";
import { withTerminalView } from "@/lib/fleet-context";
import { useWatchNarration } from "@/hooks/use-watch-narration";
import { ProjectAutopilotToggle } from "@/components/control/ProjectAutopilotToggle";
import type { AutoInjectMode } from "@/config/beacon";
import type { RunTrack as RunTrackData } from "@/lib/run-track";
import type { RunFollow } from "@/lib/run-handoff";
import type { FixNote } from "@/lib/feedback/fix-note";
import { RunTrack } from "./RunTrack";
import { RunLook } from "./RunLook";
import { Walkthrough } from "./Walkthrough";

export type WatchCardPhase =
  "waiting" | "working" | "attention" | "following" | "live" | "finished" | "stopped";

export function ProjectWatchLive({
  projectId,
  provider,
  startedAt,
  finishedAt,
  phase,
  screen,
  fallbackHeadline,
  tab,
  terminalHref,
  autopilot,
  track,
  follow,
  walkthrough,
  actions = null,
}: {
  projectId: string;
  provider: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** The card's one state, decided by the page from the run and the track. */
  phase: WatchCardPhase;
  /** The agent's screen as Watch last peeked it, or null before the first peek. */
  screen: string[] | null;
  /** What to say before Loki has narrated anything — the agent's own step. */
  fallbackHeadline: string;
  tab: string | null;
  terminalHref: string | null;
  autopilot: { override: AutoInjectMode | null; inherited: AutoInjectMode } | null;
  track: RunTrackData | null;
  follow: RunFollow | null;
  walkthrough: FixNote | null;
  /** The way forward when the run stopped — under the headline that says why,
   *  so the reason and the button are one glance, not three screens apart. */
  actions?: React.ReactNode;
}) {
  const working = phase === "working";
  const live = phase === "waiting" || phase === "working" || phase === "attention";
  const story = useWatchNarration(projectId, screen, working);
  const now = story.at(-1)?.narration ?? null;
  const earlier = story.slice(0, -1).reverse();
  const { effectiveMode, setOverride } = useProjectAutopilot(
    autopilot?.override,
    autopilot?.inherited ?? "off",
  );
  const autopilotOn = effectiveMode === "on";

  const headline = working
    ? (now?.headline ?? fallbackHeadline)
    : (track?.summary ?? fallbackHeadline);
  const liveStage = track?.stages.find((s) => s.id === "live") ?? null;
  const liveHref = phase === "live" ? (liveStage?.href ?? follow?.liveUrl ?? null) : null;

  return (
    <section className="ui-watch-live" aria-live="polite">
      <p className="ui-watch-live-kicker">
        <Dot phase={phase} />
        {KICKER[phase](provider)}
        {(startedAt || finishedAt) && (
          <span className="text-text-muted">
            ·{" "}
            {finishedAt
              ? `finished ${timeAgo(new Date(finishedAt).getTime())}`
              : working
                ? `started ${timeAgo(new Date(startedAt!).getTime())}`
                : `asked ${timeAgo(new Date(startedAt!).getTime())}`}
          </span>
        )}
      </p>

      <div className="space-y-1">
        <h2 key={headline} className="ui-watch-headline">
          {headline}
        </h2>
        {working && now?.detail && <p className="text-sm text-text-secondary">{now.detail}</p>}
      </div>

      {phase === "stopped" && actions}

      {working && now?.needsYou && (
        <div className="ui-callout-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-text-primary">It needs you</p>
            <p className="text-text-secondary">{now.needsYou}</p>
            {terminalHref && (
              <Link href={withTerminalView(terminalHref, "chat")} className="ui-chat-link">
                Answer it
              </Link>
            )}
          </div>
        </div>
      )}

      {/* The facts under the story: which stages have evidence behind them,
          with how long each took and a clock on the one happening now. */}
      {track && (
        <div className="border-t border-border-subtle pt-3">
          <RunTrack
            track={track}
            screen={working ? screen : null}
            terminalHref={
              working && terminalHref
                ? `${withTerminalView(terminalHref, "terminal")}&explain=1`
                : null
            }
          />
        </div>
      )}

      {liveHref && (
        <a
          href={liveHref}
          target="_blank"
          rel="noopener noreferrer"
          className="ui-btn-primary gap-1.5"
        >
          Open the live page <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
      )}

      {walkthrough && !live && (
        <Walkthrough note={walkthrough} liveUrl={follow?.liveUrl ?? liveStage?.href ?? null} />
      )}

      {follow && !live && <RunLook follow={follow} />}

      {working && earlier.length > 0 && (
        <ol className="ui-watch-story" aria-label="So far">
          {earlier.map((beat) => (
            <li key={`${beat.at}-${beat.narration.headline}`} className="ui-watch-story-item">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-positive" aria-hidden="true" />
              <span className="min-w-0 flex-1">{beat.narration.headline}</span>
              <span className="shrink-0 text-xs text-text-muted">{timeAgo(beat.at)}</span>
            </li>
          ))}
        </ol>
      )}

      {live && tab && <SteerBox tab={tab} />}

      {live && autopilot && (
        <div className="flex flex-col items-start gap-3 border-t border-border-subtle pt-3">
          <ProjectAutopilotToggle
            projectId={projectId}
            currentOverride={autopilot.override}
            inheritedMode={autopilot.inherited}
            onOverrideChange={setOverride}
          />
          <p className="min-w-0 flex-1 text-xs text-text-secondary">
            {autopilotOn
              ? "Autopilot is on — when this is done it picks the next step by itself."
              : "Autopilot is paused — it finishes this, then waits for you."}
          </p>
        </div>
      )}

      {live && terminalHref && (
        <Link
          href={`${withTerminalView(terminalHref, "terminal")}&explain=1`}
          className="ui-chat-link"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Look closer — the agent&apos;s
          screen, explained
        </Link>
      )}
    </section>
  );
}

const KICKER: Record<WatchCardPhase, (provider: string) => string> = {
  waiting: () => "Next in line",
  working: (p) => `${p} is working`,
  attention: () => "Needs you",
  following: () => "On its way",
  live: () => "Live",
  finished: () => "Finished",
  stopped: () => "Stopped",
};

function Dot({ phase }: { phase: WatchCardPhase }) {
  if (phase === "working" || phase === "following")
    return <span className="ui-watch-live-dot" aria-hidden="true" />;
  const tone =
    phase === "live"
      ? "ui-dot-positive"
      : phase === "attention"
        ? "ui-dot-warning"
        : phase === "stopped"
          ? "ui-dot-negative"
          : "ui-dot-neutral";
  return <span className={`ui-dot ${tone}`} aria-hidden="true" />;
}

/** One sentence into the running session — steering without opening Terminal. */
function SteerBox({ tab }: { tab: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    const prompt = text.trim();
    if (!prompt || state === "sending") return;
    setState("sending");
    setError(null);
    postJson("/api/control/tab-inject", { tab, prompt })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string; blocked?: boolean };
        if (!res.ok) throw new Error(body.error ?? `Could not send (HTTP ${res.status})`);
        if (body.blocked)
          throw new Error("Someone is typing in that session — try again in a moment.");
        setText("");
        setState("sent");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not send");
        setState("idle");
      });
  };

  return (
    <div className="space-y-1">
      <form
        className="ui-watch-steer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (state === "sent") setState("idle");
          }}
          placeholder="Tell it something — “make the header green”"
          aria-label="Tell the agent something"
          maxLength={4000}
          className="ui-watch-steer-input"
        />
        <button
          type="submit"
          disabled={!text.trim() || state === "sending"}
          className="ui-btn-primary ui-btn-icon shrink-0"
          aria-label="Send to the agent"
        >
          {state === "sending" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </form>
      {state === "sent" && (
        <p className="text-xs text-text-secondary">Sent — it reads it at its next step.</p>
      )}
      {error && <p className="ui-error text-xs">{error}</p>}
    </div>
  );
}
