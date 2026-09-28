"use client";

/**
 * Watch it work — one project's run as a readable thread, live.
 *
 * You → what the agent was asked. Loki → each hop, in words, collapsed so a
 * hundred heartbeats read as one "working" line. Screen → the last lines the
 * agent printed, refreshed while it works. Agent → what it says it did and
 * what comes next. One next action at the bottom, chosen by the phase — never
 * a raw terminal as the first thing a person sees on a phone.
 *
 * The data is lib/project-watch (pure) behind /api/projects/[id]/watch; the
 * screen tail is the same capture Control's peek drawer uses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Check, Loader2, SquareTerminal, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/dates";
import { peekTabOnce } from "@/lib/peek-tab-client";
import { tailForWatch, type WatchItem } from "@/lib/project-watch";
import { KICKOFF_STEP_LABEL } from "@/lib/project-kickoff";
import type { KickoffRunState } from "@/lib/kickoff/orchestrate";

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
  } | null;
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
  const [showAllSteps, setShowAllSteps] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const live = Boolean(data?.run?.live || data?.kickoff?.running);
  const working = data?.status?.phase === "working" && data.status.terminalReady;

  // Every setState lives in a promise callback, so the effects below can start
  // a load directly (the same shape as ActivityTimeline).
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

  // The screen tail, only while an agent is actually producing output.
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

  // Follow the thread as it grows, like a chat.
  const itemCount = data?.items.length ?? 0;
  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [itemCount, live]);

  if (!data && !error) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the run…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="ui-card-shell space-y-3 p-4">
        <p className="text-sm text-text-primary">Couldn&apos;t load the run.</p>
        <p className="text-xs text-text-secondary">{error}</p>
        <button type="button" onClick={() => void load()} className="ui-btn-secondary">
          Try again
        </button>
      </div>
    );
  }

  const payload = data!;
  // Older steps fold away once there are enough to be noise: you, the agent
  // and the latest four steps stay. Folding one step away just adds a button.
  const stepTotal = payload.items.filter((i) => i.type === "step").length;
  const hiddenSteps = showAllSteps || stepTotal <= 6 ? 0 : stepTotal - 4;
  const youItems = payload.items.filter((i) => i.type === "you");
  const restItems = payload.items.filter(
    (item, i) =>
      item.type !== "you" &&
      (item.type !== "step" ||
        payload.items.slice(0, i + 1).filter((x) => x.type === "step").length > hiddenSteps),
  );

  return (
    <div className="space-y-4">
      {payload.kickoff?.running && <SetupCard kickoff={payload.kickoff} />}

      {!payload.run && !payload.kickoff?.running && (
        <div className="ui-card-shell space-y-3 p-4">
          <p className="text-sm font-medium text-text-primary">Nothing has been started yet.</p>
          <p className="text-sm text-text-secondary">
            Start it from the project — the conversation shows up here as soon as an agent picks it
            up.
          </p>
          <Link href={profileHref} className="ui-btn-primary">
            Go to Make it happen
          </Link>
        </div>
      )}

      {payload.run && (
        <ol className="space-y-3" aria-live="polite">
          {youItems.map((item, i) => (
            <WatchRow key={`you-${item.at}-${i}`} item={item} />
          ))}
          {hiddenSteps > 0 && (
            <li className="pl-1">
              <button
                type="button"
                onClick={() => setShowAllSteps(true)}
                className="ui-btn-ghost ui-btn-xs"
              >
                Show {hiddenSteps} earlier steps
              </button>
            </li>
          )}
          {restItems.map((item, i) => (
            <WatchRow key={`${item.type}-${item.at}-${i}`} item={item} />
          ))}
        </ol>
      )}

      {payload.run && payload.status && (
        <StatusCard
          status={payload.status}
          live={payload.run.live}
          tail={working ? tail : null}
          terminalHref={payload.terminalHref ?? null}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function WatchRow({ item }: { item: WatchItem }) {
  if (item.type === "you") return <YouBubble text={item.text} at={item.at} />;
  if (item.type === "agent") {
    return (
      <li className="flex gap-2.5">
        <span className="ui-watch-avatar" aria-hidden="true">
          <Bot className="h-4 w-4" />
        </span>
        <div className="ui-watch-bubble min-w-0 flex-1">
          <p className="ui-micro-label">Agent · {timeAgo(new Date(item.at).getTime())}</p>
          {item.done && (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-primary wrap-anywhere">
              {item.done}
            </p>
          )}
          {item.next && (
            <p className="mt-2 text-sm text-text-secondary wrap-anywhere">
              <span className="font-medium text-text-primary">Next: </span>
              {item.next}
            </p>
          )}
          {item.commit && (
            <p className="mt-2 text-xs text-text-tertiary wrap-anywhere">{item.commit}</p>
          )}
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2.5 pl-1 text-sm">
      <span
        className={cn(
          "ui-dot mt-1.5 shrink-0",
          item.tone === "warning" ? "ui-dot-warning" : "ui-dot-neutral",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className={item.tone === "warning" ? "text-status-warning" : "text-text-secondary"}>
          {item.text}
        </span>
        <span className="ml-2 text-xs text-text-muted">{timeAgo(new Date(item.at).getTime())}</span>
      </span>
    </li>
  );
}

function YouBubble({ text, at }: { text: string; at: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <li className="flex gap-2.5">
      <span className="ui-watch-avatar" aria-hidden="true">
        <User className="h-4 w-4" />
      </span>
      <div className="ui-watch-bubble min-w-0 flex-1">
        <p className="ui-micro-label">You asked · {timeAgo(new Date(at).getTime())}</p>
        <p
          className={cn(
            "mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-primary wrap-anywhere",
            long && !open && "line-clamp-4",
          )}
        >
          {text}
        </p>
        {long && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-1 text-xs font-medium text-text-tertiary hover:text-text-secondary"
          >
            {open ? "Show less" : "Show the full brief"}
          </button>
        )}
      </div>
    </li>
  );
}

function StatusCard({
  status,
  live,
  tail,
  terminalHref,
}: {
  status: NonNullable<WatchPayload["status"]>;
  live: boolean;
  tail: string[] | null;
  terminalHref: string | null;
}) {
  const working = status.phase === "working";
  return (
    <section className="ui-card-shell space-y-3 p-4" aria-label="Right now">
      <div className="flex items-center gap-2">
        {live && !status.stalled ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-text" aria-hidden="true" />
        ) : !live ? (
          <Check className="h-4 w-4 shrink-0 text-status-positive" aria-hidden="true" />
        ) : (
          <span className="ui-dot ui-dot-warning shrink-0" aria-hidden="true" />
        )}
        <p className="text-sm font-medium text-text-primary">{status.label}</p>
        {status.lastProgressAt && live && (
          <span className="ml-auto shrink-0 text-xs text-text-muted">
            active {timeAgo(new Date(status.lastProgressAt).getTime())}
          </span>
        )}
      </div>
      <p className="text-sm text-text-secondary">{status.nextAction}</p>

      {working && (
        <div>
          <p className="ui-micro-label mb-1">On the agent&apos;s screen</p>
          <pre className="ui-watch-tail">
            {tail === null
              ? "Reading the screen…"
              : tail.length === 0
                ? "Nothing printed yet."
                : tail.join("\n")}
          </pre>
        </div>
      )}

      {/* Only when there is a session to open — offering a terminal while the
          builder is offline sends someone to a blank screen. */}
      {terminalHref && status.terminalReady && (
        <Link href={terminalHref} className="ui-btn-secondary gap-2">
          <SquareTerminal className="h-4 w-4" aria-hidden="true" />
          {status.stalled ? "Open the terminal to answer it" : "Open the full terminal"}
        </Link>
      )}
    </section>
  );
}

function SetupCard({ kickoff }: { kickoff: KickoffRunState }) {
  return (
    <section className="ui-card-shell space-y-2 p-4" aria-label="Setting up">
      <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <Loader2 className="h-4 w-4 animate-spin text-accent-text" aria-hidden="true" />
        Setting up — the agent starts next
      </p>
      <ol className="space-y-1.5">
        {kickoff.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            {s.state === "done" ? (
              <Check className="h-4 w-4 shrink-0 text-status-positive" aria-hidden="true" />
            ) : s.state === "running" ? (
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-accent-text"
                aria-hidden="true"
              />
            ) : (
              <span
                className={cn(
                  "ui-dot mx-1.5 shrink-0",
                  s.state === "failed" ? "ui-dot-negative" : "ui-dot-neutral",
                )}
                aria-hidden="true"
              />
            )}
            <span className={s.state === "pending" ? "text-text-tertiary" : "text-text-primary"}>
              {KICKOFF_STEP_LABEL[s.id]}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
