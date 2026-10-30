"use client";

/**
 * Watch it work — one project's run as a live conversation.
 *
 * You asked (right) → Loki narrates, one folded activity line for the
 * mechanical hops → the agent's screen while it works → the agent's own
 * summary when it is done. When a run cannot go on, Loki says why in one
 * sentence and the way forward is ONE tap in the same message ("Try Codex"),
 * never a status card that names a problem and stops (2026-09-29).
 *
 * Data: lib/project-watch (pure) behind /api/projects/[id]/watch; the retry is
 * /api/projects/[id]/watch/retry over lib/project-retry, the same path Loki
 * takes by itself when a builder refuses a run.
 */

import { useMemo, useEffect, useState } from "react";
import Link from "next/link";
import { singleFlight } from "@/lib/single-flight";
import { Loader2, MessagesSquare, RotateCcw } from "lucide-react";
import { withTerminalView } from "@/lib/fleet-context";
import { timeAgo } from "@/lib/dates";
import { postJson } from "@/lib/api/fetch";
import { peekTabOnce } from "@/lib/peek-tab-client";
import {
  humanizeRunFailure,
  latestActivityLine,
  tailForWatch,
  type WatchItem,
} from "@/lib/project-watch";
import { KICKOFF_STEP_LABEL } from "@/lib/project-kickoff";
import type { KickoffRunState } from "@/lib/kickoff/orchestrate";
import { ProviderSwitch } from "@/components/agents/ProviderSwitch";
import { FAILURE_REMEDY, remedyForFailure } from "@/lib/failure-remedy";
import type { AutoInjectMode } from "@/config/beacon";
import { ProjectWatchLive, type WatchCardPhase } from "./ProjectWatchLive";
import { ActivityGroup, AssistantMessage, TypingDots, UserMessage } from "./project-watch-parts";
import type { RunTrack as RunTrackData } from "@/lib/run-track";
import type { RunFollow } from "@/lib/run-handoff";
import type { FixNote } from "@/lib/feedback/fix-note";

type WatchPayload = {
  project: { name: string };
  kickoff: KickoffRunState | null;
  run: { id: string; startedAt: string; finishedAt: string | null; live: boolean } | null;
  items: WatchItem[];
  status: {
    phase: string;
    label: string;
    stepSummary: string;
    nextAction: string;
    stalled: boolean;
    terminalReady: boolean;
    lastProgressAt: string | null;
    error: string | null;
  } | null;
  /** Where the change is, stage by stage — see lib/run-track. */
  track?: RunTrackData | null;
  /** The change can still move (merge, deploy, Loki's look): keep asking. */
  following?: boolean;
  /** The chat card's follow line — read here for the picture Loki took. */
  follow?: RunFollow | null;
  /** The agent's account of the change, from the pull request. */
  walkthrough?: FixNote | null;
  liveUrl?: string | null;
  provider?: {
    current: string;
    currentLabel: string;
    reroutedFrom: string | null;
    reroutedFromLabel: string | null;
    reroutedWhy?: "spent" | "not-installed" | "picked" | null;
    autoRetriedBecause: string | null;
    quotaDeath: boolean;
  };
  canRetry?: boolean;
  userProjectId?: string | null;
  tab?: string;
  terminalHref?: string;
  autopilot?: { override: AutoInjectMode | null; inherited: AutoInjectMode };
};

const LIVE_POLL_MS = 4_000;
/** After the run: merge, deploy and the look move on GitHub's clock. The
 *  server asks GitHub at most once a minute; this is how fast the page
 *  learns about it. */
const FOLLOW_POLL_MS = 10_000;
const IDLE_POLL_MS = 20_000;
const TAIL_MS = 6_000;

export function ProjectWatch({
  projectId,
  profileHref,
  runId,
}: {
  projectId: string;
  profileHref: string;
  /** One run to follow (the widget's "Follow the build"); default: the latest. */
  runId?: string;
}) {
  const [data, setData] = useState<WatchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tail, setTail] = useState<string[] | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const live = Boolean(data?.run?.live || data?.kickoff?.running || retrying);
  const following = Boolean(!live && data?.following);
  const working = data?.status?.phase === "working" && data.status.terminalReady;

  // Every setState lives in a promise callback, so effects can start a load.
  const load = useMemo(
    () =>
      singleFlight(() =>
        fetch(
          `/api/projects/${projectId}/watch${runId ? `?run=${encodeURIComponent(runId)}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          },
        )
          .then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as WatchPayload & { error?: string };
            if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
            setData(body);
            setError(null);
          })
          .catch((e: unknown) => {
            setError(
              e instanceof DOMException && e.name === "TimeoutError"
                ? "The run is taking too long to load. Try again."
                : e instanceof Error
                  ? e.message
                  : "Could not load the run",
            );
          }),
      ),
    [projectId, runId],
  );

  useEffect(() => {
    void load();
    const id = setInterval(
      () => {
        if (!document.hidden) void load();
      },
      live ? LIVE_POLL_MS : following ? FOLLOW_POLL_MS : IDLE_POLL_MS,
    );
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, live, following]);

  // The agent's screen, only while it is actually producing output.
  const tab = data?.tab ?? null;
  useEffect(() => {
    if (!working || !tab) return;
    let alive = true;
    const grab = () =>
      peekTabOnce(tab, () => alive)
        .then((screen) => alive && screen !== null && setTail(tailForWatch(screen)))
        .catch(() => undefined);
    void grab();
    const id = setInterval(() => void grab(), TAIL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [working, tab]);

  // No auto-scroll: while it works, the live card at the top IS the news —
  // following the thread down used to scroll it out of view.

  const retry = (agent?: string) => {
    setRetrying(true);
    setRetryError(null);
    postJson(`/api/projects/${projectId}/watch/retry`, agent ? { agent } : {})
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return load();
      })
      .catch((e: unknown) => setRetryError(e instanceof Error ? e.message : "Retry failed"))
      .finally(() => setRetrying(false));
  };

  const tryAgain = (primary: boolean) => (
    <button
      type="button"
      onClick={() => retry()}
      disabled={retrying}
      className={primary ? "ui-btn-primary gap-1.5" : "ui-btn-secondary gap-1.5"}
    >
      {retrying ? <Loader2 className="ui-spinner-xs" /> : <RotateCcw className="h-3.5 w-3.5" />}
      Try again
    </button>
  );

  if (!data && !error) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (error && !data) {
    return (
      <AssistantMessage who="Loki">
        <p>I couldn&apos;t load this run. {error}</p>
        <button type="button" onClick={() => void load()} className="ui-btn-secondary mt-2">
          Try again
        </button>
      </AssistantMessage>
    );
  }

  const p = data!;
  const you = p.items.filter((i) => i.type === "you");
  const steps = p.items.filter((i): i is Extract<WatchItem, { type: "step" }> => i.type === "step");
  const agentMsgs = p.items.filter((i) => i.type === "agent");
  const status = p.status;
  const provider = p.provider;
  const failed = Boolean(p.canRetry);
  const runLive = Boolean(p.run?.live);
  // The same request again on the same agent fails the same way when that
  // agent is not on the builder at all, so — like a usage wall — the agent
  // that IS there is the one action, and "Try again" only its fallback.
  const switchFirst =
    Boolean(provider?.quotaDeath) ||
    remedyForFailure(status?.error) === FAILURE_REMEDY.SWITCH_AGENT;
  const failureActions = failed ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {switchFirst ? (
          <ProviderSwitch
            projectId={p.userProjectId ?? null}
            busy={retrying}
            primary
            hint="Sends the same request to the provider you pick, and remembers it for this project."
            onSwitch={(agent) => retry(agent)}
            fallback={tryAgain(true)}
          />
        ) : (
          <>
            {tryAgain(true)}
            <ProviderSwitch
              projectId={p.userProjectId ?? null}
              busy={retrying}
              hint="Sends the same request to the provider you pick, and remembers it for this project."
              onSwitch={(agent) => retry(agent)}
            />
          </>
        )}
      </div>
      {retryError && <p className="ui-error text-xs">{retryError}</p>}
    </div>
  ) : null;
  // With a delivery track the card already tells the run's history and says
  // why it stopped; the folded "Stopped · 3 steps" line and a Loki message
  // repeating the card's headline put the same facts on screen three times.
  const tracked = Boolean(p.track);

  return (
    <div className="space-y-6" aria-live="polite">
      {p.kickoff?.running && <SetupMessage kickoff={p.kickoff} />}

      {p.run && status && (
        <ProjectWatchLive
          key={p.run.id}
          projectId={projectId}
          phase={cardPhase({
            runLive,
            working: Boolean(working),
            failed,
            stalled: status.stalled,
            track: p.track ?? null,
          })}
          provider={provider?.currentLabel ?? "The agent"}
          startedAt={p.run.startedAt}
          finishedAt={p.run.finishedAt}
          screen={working ? tail : null}
          fallbackHeadline={
            (working && tail && latestActivityLine(tail)) ||
            (working ? status.label : waitingHeadline(status.label))
          }
          tab={runLive && status.terminalReady ? (p.tab ?? null) : null}
          terminalHref={runLive && status.terminalReady ? (p.terminalHref ?? null) : null}
          autopilot={p.autopilot ?? null}
          track={p.track ?? null}
          follow={p.follow ?? null}
          walkthrough={p.walkthrough ?? null}
          actions={tracked ? failureActions : null}
        />
      )}

      {!p.run && !p.kickoff?.running && (
        <AssistantMessage who="Loki">
          <p>Nothing is running for this project yet.</p>
          <Link href={profileHref} className="ui-btn-primary mt-3">
            Make it happen
          </Link>
        </AssistantMessage>
      )}

      {you.map((m, i) => (
        <UserMessage key={`you-${i}`} text={m.text} at={m.at} />
      ))}

      {p.run && provider?.autoRetriedBecause && (
        <AssistantMessage who="Loki">
          <p>
            {provider.reroutedFrom
              ? `The first try stopped because ${provider.autoRetriedBecause}, so I sent it again on ${provider.currentLabel}.`
              : `The first try stopped because ${provider.autoRetriedBecause}, so I sent it again.`}
          </p>
        </AssistantMessage>
      )}
      {p.run &&
        provider?.reroutedFrom &&
        !provider.autoRetriedBecause &&
        provider.reroutedWhy !== "picked" && (
          <AssistantMessage who="Loki">
            <p>{rerouteSentence(provider)}</p>
          </AssistantMessage>
        )}

      {p.run && status && !tracked && (
        // The live message below already says "Working · 1 min" with its
        // own dots. Saying it here too, with a second spinner, put the same
        // fact on screen three times (operator, 2026-10-07): this line is
        // the run's history, so it says when it started.
        <ActivityGroup
          steps={steps}
          summary={
            failed
              ? "Stopped"
              : runLive && p.run
                ? `Started ${timeAgo(new Date(p.run.startedAt).getTime())}`
                : "Finished"
          }
        />
      )}

      {agentMsgs.map((m, i) =>
        m.type === "agent" ? (
          <AssistantMessage
            key={`agent-${i}`}
            who={provider?.currentLabel ?? "Agent"}
            at={m.at}
            agent
          >
            {m.done && <p className="whitespace-pre-wrap wrap-anywhere">{m.done}</p>}
            {m.next && (
              <p className="text-text-secondary">
                <span className="font-medium text-text-primary">Next: </span>
                {m.next}
              </p>
            )}
          </AssistantMessage>
        ) : null,
      )}

      {p.run && status && runLive && !failed && status.stalled && (
        <AssistantMessage who="Loki">
          <p>{status.nextAction}</p>
          {p.terminalHref && status.terminalReady && (
            <Link href={withTerminalView(p.terminalHref, "chat")} className="ui-chat-link">
              <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" /> See where{" "}
              {provider?.currentLabel ?? "the agent"} stopped
            </Link>
          )}
        </AssistantMessage>
      )}

      {p.run && status && failed && !tracked && (
        <AssistantMessage who="Loki">
          <p>
            {humanizeRunFailure(
              status.error,
              provider?.currentLabel ?? "The agent",
              Boolean(provider?.quotaDeath),
            )}{" "}
            {switchFirst ? "Send it to an agent that can take it:" : "Send it again:"}
          </p>
          {failureActions}
        </AssistantMessage>
      )}

      {p.run && !runLive && !failed && agentMsgs.length === 0 && status && !p.track && (
        <AssistantMessage who="Loki">
          <p>
            {status.label}. {status.nextAction}
          </p>
        </AssistantMessage>
      )}
    </div>
  );
}

function SetupMessage({ kickoff }: { kickoff: KickoffRunState }) {
  const current = kickoff.steps.find((s) => s.state === "running");
  const done = kickoff.steps.filter((s) => s.state === "done").length;
  return (
    <AssistantMessage who="Loki">
      <div className="flex items-center gap-3">
        <TypingDots />
        <span>
          {current ? `${KICKOFF_STEP_LABEL[current.id]}…` : "Setting up…"}
          <span className="ml-2 text-text-muted">
            {done} of {kickoff.steps.length}
          </span>
        </span>
      </div>
    </AssistantMessage>
  );
}

/**
 * The card's one state. The track decides the after-run phases (following
 * until it settles, then live or stopped); the run and the phase line decide
 * the live ones. One place, so the kicker, the dot and what the card shows
 * can never disagree.
 */
function cardPhase(input: {
  runLive: boolean;
  working: boolean;
  failed: boolean;
  stalled: boolean;
  track: RunTrackData | null;
}): WatchCardPhase {
  if (input.failed) return "stopped";
  if (input.runLive) {
    if (input.stalled || input.track?.stages.some((s) => s.state === "attention"))
      return "attention";
    return input.working ? "working" : "waiting";
  }
  const live = input.track?.stages.find((s) => s.id === "live");
  if (live?.state === "done") return "live";
  if (input.track?.stages.some((s) => s.state === "failed")) return "stopped";
  // Settled but waiting on a person (no pull request found): not "Live".
  if (input.track?.stages.some((s) => s.state === "attention")) return "attention";
  if (input.track && !input.track.settled) return "following";
  // Settled without reaching the live site and without failing: finished,
  // not "Live" — a branch with no pull request, or a run older than Loki
  // follows, said "Live" here with a green dot.
  return "finished";
}

/** Why this run went to another agent than the one it was meant for. */
function rerouteSentence(provider: NonNullable<WatchPayload["provider"]>): string {
  const from = provider.reroutedFromLabel ?? "the agent it was meant for";
  if (provider.reroutedWhy === "not-installed")
    return `Sent to ${provider.currentLabel} — ${from} is not installed on the runner this project uses.`;
  if (provider.reroutedWhy === "spent")
    return `Sent to ${provider.currentLabel} — ${from} was out of usage.`;
  // Older runs did not record why; the only claim on record is the switch.
  return `Sent to ${provider.currentLabel} instead of ${from}.`;
}

/** A one-word state ("Queued") as a headline a person can read. */
function waitingHeadline(label: string): string {
  return /^queued$/i.test(label.trim()) ? "Waiting for a runner to pick it up." : label;
}
