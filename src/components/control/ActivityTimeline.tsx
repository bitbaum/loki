"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { useKickoffRunForTab } from "@/lib/kickoff-run";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/dates";
import { STATUS_DOT_CLASS, formatActivityTime } from "@/components/activity/activity-shared";
import type { ActivityKind, ProjectActivityEvent } from "@/db/queries/activity";

/**
 * Per-project activity timeline — renders the unified activity SSOT
 * (/api/control/activity → getProjectActivity) as a clean, newest-first feed:
 * every prompt dispatched, every run outcome, every lifecycle signal. This is
 * the "what has happened" half of the project cockpit (the live terminal is the
 * "now" half). Read-only; auto-refreshes while open so it tracks a working agent.
 */

const KIND_LABEL: Record<ActivityKind, string> = {
  dispatch: "Prompt",
  task_completed: "Done",
  task_failed: "Failed",
  input_requested: "Waiting",
  session_closed: "Closed",
  funding: "Funded",
};

const SOURCE_LABEL: Record<string, string> = {
  user: "you",
  autopilot: "autopilot",
  runner: "runner",
};

const REFRESH_MS = 5_000;

export function ActivityTimeline({ tab }: { tab: string }) {
  const [events, setEvents] = useState<ProjectActivityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const seq = useRef(0);

  // Fetch without touching state synchronously — every setState lives in a
  // promise callback, so the mount effect can call this directly. The spinner
  // is primed by useState(true) on mount, by the render-time adjustment below
  // on tab change, and by load() for interval/retry refreshes.
  const fetchEvents = () => {
    const mine = ++seq.current;
    return fetch(`/api/control/activity?tab=${encodeURIComponent(tab)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (mine !== seq.current) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Activity request failed (${res.status})`);
        }
        const body = (await res.json()) as { events: ProjectActivityEvent[] };
        if (mine !== seq.current) return;
        setError(null);
        setEvents(body.events);
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setError((e as Error).message || "Couldn't load activity");
      })
      .finally(() => {
        if (mine === seq.current) setRefreshing(false);
      });
  };

  // Event-context refresh (interval tick, retry button).
  const load = () => {
    setRefreshing(true);
    return fetchEvents();
  };

  // Tab change re-arms the spinner in the same render pass (guarded
  // adjustment); the effect below re-fetches.
  const [prevTab, setPrevTab] = useState(tab);
  if (tab !== prevTab) {
    setPrevTab(tab);
    setRefreshing(true);
  }

  useEffect(() => {
    void fetchEvents();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchEvents/load close over `tab`, which is the effect's real input
  }, [tab]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-1 pb-2">
        <span className="ui-micro-label">Activity · last 7 days</span>
        {refreshing && <Loader2 className="h-3 w-3 animate-spin text-text-tertiary" aria-hidden />}
      </div>

      {error ? (
        <div className="px-1 text-sm text-text-secondary">
          <p className="font-medium text-status-warning">Couldn&apos;t load activity</p>
          <p className="mt-2 text-text-tertiary">{error}</p>
          <button type="button" onClick={() => void load()} className="ui-btn-ghost ui-btn-xs mt-3">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : events === null ? (
        <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading activity…
        </div>
      ) : events.length === 0 ? (
        <EmptyActivity tab={tab} />
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-overlay"
            >
              <span
                className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATUS_DOT_CLASS[ev.status])}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="ui-badge shrink-0">{KIND_LABEL[ev.kind]}</span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      ev.status === "negative" ? "text-status-negative" : "text-text-primary",
                    )}
                    title={ev.title}
                  >
                    {ev.title}
                  </span>
                  <span
                    className="shrink-0 text-micro text-text-muted tabular-nums"
                    title={formatActivityTime(ev.at)}
                  >
                    {timeAgo(Date.parse(ev.at))}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-micro text-text-muted">
                  <span>{SOURCE_LABEL[ev.source] ?? ev.source}</span>
                  {ev.adapter && <span>· {ev.adapter}</span>}
                  {ev.detail && (
                    <span className="min-w-0 truncate text-text-tertiary" title={ev.detail}>
                      · {ev.detail}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * An empty timeline is either "nothing has happened" or "it is being set up
 * right now and the first prompt has not gone out yet". The old copy said
 * "Dispatch a prompt" in both cases, with nothing to press — to someone who
 * had just pressed Make it happen, that read as "it didn't work".
 */
function EmptyActivity({ tab }: { tab: string }) {
  const kickoff = useKickoffRunForTab(tab);
  if (kickoff?.running) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-text-secondary" aria-hidden />
        <p className="font-medium text-text-primary">Setting up this project</p>
        <p className="max-w-sm text-text-tertiary">
          The agent&apos;s first prompt shows up here as soon as setup hands it over.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm">
      <p className="font-medium text-text-primary">No activity yet</p>
      <p className="max-w-sm text-text-tertiary">
        Every prompt, run and result for this project lands here once an agent starts.
      </p>
      <Link href={fleetSurfaceHref("profile", tab)} className="ui-btn-secondary ui-btn-xs mt-1">
        Start it from the project
      </Link>
    </div>
  );
}
