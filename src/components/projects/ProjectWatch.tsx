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

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MessagesSquare, RotateCcw, Sparkles } from "lucide-react";
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
import {
  ActivityGroup,
  AssistantMessage,
  ScreenFold,
  TypingDots,
  UserMessage,
} from "./project-watch-parts";

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
  provider?: {
    current: string;
    currentLabel: string;
    reroutedFrom: string | null;
    reroutedFromLabel: string | null;
    autoRetriedBecause: string | null;
    quotaDeath: boolean;
  };
  canRetry?: boolean;
  userProjectId?: string | null;
  tab?: string;
  terminalHref?: string;
};

const LIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 20_000;
const TAIL_MS = 6_000;

export function ProjectWatch({
  projectId,
  profileHref,
}: {
  projectId: string;
  profileHref: string;
}) {
  const [data, setData] = useState<WatchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tail, setTail] = useState<string[] | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const live = Boolean(data?.run?.live || data?.kickoff?.running || retrying);
  const working = data?.status?.phase === "working" && data.status.terminalReady;

  // Every setState lives in a promise callback, so effects can start a load.
  const load = useCallback(
    () =>
      fetch(`/api/projects/${projectId}/watch`, { cache: "no-store" })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as WatchPayload & { error?: string };
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
          setData(body);
          setError(null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "Could not load the run");
        }),
    [projectId],
  );

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), live ? LIVE_POLL_MS : IDLE_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, live]);

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

  // Follow the conversation as it grows.
  const itemCount = data?.items.length ?? 0;
  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [itemCount, live]);

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

  return (
    <div className="space-y-6" aria-live="polite">
      {p.kickoff?.running && <SetupMessage kickoff={p.kickoff} />}

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
      {p.run && provider?.reroutedFrom && !provider.autoRetriedBecause && (
        <AssistantMessage who="Loki">
          <p>
            Switched to {provider.currentLabel} —{" "}
            {provider.reroutedFromLabel ?? "the previous provider"} was out of usage.
          </p>
        </AssistantMessage>
      )}

      {p.run && status && (
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

      {p.run && status && runLive && !failed && (
        <AssistantMessage who={provider?.currentLabel ?? "Agent"} agent>
          <div className="flex items-start gap-3">
            <span className="pt-2.5">
              <TypingDots />
            </span>
            <span className="min-w-0 text-text-secondary wrap-anywhere">
              {status.stalled
                ? status.nextAction
                : ((working && tail && latestActivityLine(tail)) ?? status.label)}
            </span>
          </div>
          {working && tail && tail.length > 0 && <ScreenFold lines={tail} />}
          {p.terminalHref && status.terminalReady && (
            // The question a person watching actually has, answered in plain
            // words on the session itself, with what they can say next — or
            // leave it be. It opens the terminal with Loki already asked.
            // The agent's own conversation is the other view of the same page.
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link
                href={`${withTerminalView(p.terminalHref, "terminal")}&explain=1`}
                className="ui-btn-primary gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> What&apos;s going on?
              </Link>
              <Link href={withTerminalView(p.terminalHref, "chat")} className="ui-chat-link">
                <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" /> Follow{" "}
                {provider?.currentLabel ?? "the agent"} live
              </Link>
            </div>
          )}
        </AssistantMessage>
      )}

      {p.run && status && failed && (
        <AssistantMessage who="Loki">
          <p>
            {humanizeRunFailure(
              status.error,
              provider?.currentLabel ?? "The agent",
              Boolean(provider?.quotaDeath),
            )}{" "}
            {provider?.quotaDeath
              ? "Pick up where it left off on another provider:"
              : "Send it again:"}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {provider?.quotaDeath ? (
              // A usage wall: the next provider is the answer. Re-running the
              // spent one only appears when nothing else can answer.
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
        </AssistantMessage>
      )}

      {p.run && !runLive && !failed && agentMsgs.length === 0 && status && (
        <AssistantMessage who="Loki">
          <p>
            {status.label}. {status.nextAction}
          </p>
        </AssistantMessage>
      )}
      <div ref={bottomRef} />
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
