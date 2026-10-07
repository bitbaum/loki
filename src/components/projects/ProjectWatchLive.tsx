"use client";

/**
 * The top of Watch while an agent is working: Loki narrating the build in the
 * person's own terms, the story so far, and the two ways to drive it — steer
 * it with a sentence, or let it run on autopilot. Both feelings on one card:
 * you always know what is happening, and you choose how much to hold on
 * (operator, 2026-10-07: "the user always feels in control unless they choose
 * to let go … this is what makes us special").
 *
 * Narration: hooks/use-watch-narration over lib/watch-narration. Until the
 * first narration lands, the headline is the agent's own current step from
 * the screen, so the card never opens empty.
 */

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUp, Check, Loader2, Sparkles } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { timeAgo } from "@/lib/dates";
import { withTerminalView } from "@/lib/fleet-context";
import { useWatchNarration } from "@/hooks/use-watch-narration";
import { ProjectAutopilotToggle } from "@/components/control/ProjectAutopilotToggle";
import type { AutoInjectMode } from "@/config/beacon";

export function ProjectWatchLive({
  projectId,
  provider,
  startedAt,
  screen,
  fallbackHeadline,
  tab,
  terminalHref,
  autopilot,
}: {
  projectId: string;
  provider: string;
  startedAt: string | null;
  /** The agent's screen as Watch last peeked it, or null before the first peek. */
  screen: string[] | null;
  /** What to say before Loki has narrated anything — the agent's own step. */
  fallbackHeadline: string;
  tab: string | null;
  terminalHref: string | null;
  autopilot: { override: AutoInjectMode | null; inherited: AutoInjectMode } | null;
}) {
  const story = useWatchNarration(projectId, screen, true);
  const now = story.at(-1)?.narration ?? null;
  const earlier = story.slice(0, -1).reverse();
  const autopilotOn = (autopilot?.override ?? autopilot?.inherited) === "on";

  return (
    <section className="ui-watch-live" aria-live="polite">
      <p className="ui-watch-live-kicker">
        <span className="ui-watch-live-dot" aria-hidden="true" />
        {provider} is working
        {startedAt && (
          <span className="text-text-muted">
            · started {timeAgo(new Date(startedAt).getTime())}
          </span>
        )}
      </p>

      <div className="space-y-1">
        <h2 key={now?.headline ?? fallbackHeadline} className="ui-watch-headline">
          {now?.headline ?? fallbackHeadline}
        </h2>
        {now?.detail && <p className="text-sm text-text-secondary">{now.detail}</p>}
      </div>

      {now?.needsYou && (
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

      {earlier.length > 0 && (
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

      {tab && <SteerBox tab={tab} />}

      {autopilot && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle pt-3">
          <ProjectAutopilotToggle
            projectId={projectId}
            currentOverride={autopilot.override}
            inheritedMode={autopilot.inherited}
          />
          <p className="min-w-0 flex-1 text-xs text-text-secondary">
            {autopilotOn
              ? "Autopilot is on — when this is done it picks the next step by itself."
              : "Autopilot is paused — it finishes this, then waits for you."}
          </p>
        </div>
      )}

      {terminalHref && (
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
