"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { NAV } from "@/config/navigation";
import { trackUsage } from "@/lib/usage/track";
import type { DayPlan } from "@/lib/start-my-day/rank";
import type { FleetKickResult } from "@/lib/fleet-kick";

const ENDPOINT = "/api/control/start-my-day";
const SURFACE = "loki.start-my-day";
const REASONS: Record<string, string> = {
  paused: "Paused — open the project to resume",
  no_path: "Needs a project path — open the project to set it up",
  pending_command: "Already queued",
  busy: "Already working",
  concurrency_cap: "All work slots are in use — try again when one finishes",
  blocked: "Needs attention — open Control",
};

/** One small selection, shared by the actual front door and the fresh chat.
 * No AI call to rank it, and no launch on mount or refresh. */
export function StartMyDay() {
  const { data, loading, error, refetch } = useFetch<DayPlan>(ENDPOINT);
  // null means the suggested default; [] means the person deselected everything.
  const [selection, setSelection] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [result, setResult] = useState<FleetKickResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const projects = data?.projects ?? [];
  const selected = (selection ?? data?.selectedIds ?? []).filter((id) =>
    projects.some((p) => p.id === id && !p.unavailable && !accepted.includes(p.name)),
  );
  const visible = expanded ? projects : projects.slice(0, data?.maxProjects ?? 3);

  useEffect(() => {
    if (data) trackUsage({ surface: SURFACE, action: "shown", meta: { ids: data.selectedIds } });
  }, [data]);

  async function start(ids: string[]) {
    if (inFlight.current || ids.length === 0) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    trackUsage({
      surface: SURFACE,
      action: "tap",
      target: ids.length === 1 ? ids[0] : "selected",
      meta: { ids },
    });
    try {
      const response = await postJson(ENDPOINT, { projectIds: ids });
      if (!response.ok)
        await throwApiError(response, "Could not start. Check Control before trying again.");
      const body = (await response.json()) as { result: FleetKickResult };
      setResult(body.result);
      const names = body.result.details
        .filter((d) => d.outcome === "kicked")
        .map((d) => d.projectKey);
      setAccepted((prev) => [...new Set([...prev, ...names])]);
      // Never silently replace started choices with three more projects.
      setSelection(selected.filter((id) => !ids.includes(id)));
      refetch();
    } catch (e) {
      setFailure(
        e instanceof Error
          ? e.message
          : "Could not confirm the start. Check Control before retrying.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="ui-away w-full" aria-label="Start my day" data-start-my-day>
      <div className="ui-away-head">
        <h2 className="ui-away-title">Start my day</h2>
        <Link href={NAV.control.href} className="ui-link-muted text-xs">
          Control →
        </Link>
      </div>
      <p className="mt-1 text-sm text-text-secondary">
        Pick up recent work. Loki chooses the next useful task in each selected project.
      </p>
      {loading && !data && (
        <p className="mt-3 text-sm text-text-muted" role="status">
          Checking the past week…
        </p>
      )}
      {error && (
        <div className="mt-3" role="alert">
          <p className="ui-error">Could not check recent work.</p>
          <button className="ui-btn-secondary mt-2" type="button" onClick={refetch}>
            Try again
          </button>
        </div>
      )}
      {data && !error && (
        <>
          {projects.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">
              No development activity found in the past week.{" "}
              <Link href={NAV.projects.href} className="ui-link-muted">
                Choose a project →
              </Link>
            </p>
          ) : (
            <>
              <button
                type="button"
                className="ui-btn-primary mt-3 w-full sm:w-auto"
                disabled={busy || selected.length === 0}
                onClick={() => void start(selected)}
              >
                <Play className="h-4 w-4" aria-hidden />
                {busy
                  ? "Starting…"
                  : `Start selected${selected.length ? ` (${selected.length})` : ""}`}
              </button>
              <p className="mt-2 text-xs text-text-muted">
                Up to {data.maxProjects} projects at once. Existing autopilot settings still apply.
              </p>
              <ul className="mt-3 space-y-2">
                {visible.map((p) => {
                  const submitted = accepted.includes(p.name);
                  const disabled = busy || Boolean(p.unavailable) || submitted;
                  return (
                    <li key={p.id} className="flex items-center gap-2 min-w-0">
                      <label className="flex min-w-0 flex-1 items-center gap-2 ui-tap">
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.name}`}
                          checked={selected.includes(p.id)}
                          disabled={
                            disabled ||
                            (!selected.includes(p.id) && selected.length >= data.maxProjects)
                          }
                          onChange={() =>
                            setSelection(
                              selected.includes(p.id)
                                ? selected.filter((id) => id !== p.id)
                                : [...selected, p.id],
                            )
                          }
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm font-medium text-text-primary break-words">
                            {p.name}
                          </span>
                          <span className="text-xs text-text-muted">{p.why}</span>
                          {p.unavailable && !submitted && (
                            <span className="text-xs text-text-secondary">{p.unavailable}</span>
                          )}
                        </span>
                      </label>
                      {p.unavailable || submitted ? (
                        <Link
                          href={submitted ? NAV.control.href : p.href}
                          className="ui-btn-ghost shrink-0"
                        >
                          {submitted ? "Queued" : "Open"}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="ui-btn-secondary shrink-0"
                          aria-label={`Start ${p.name}`}
                          disabled={busy}
                          onClick={() => void start([p.id])}
                        >
                          Start
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {projects.length > data.maxProjects && (
                <button
                  type="button"
                  className="ui-btn-ghost mt-2"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded
                    ? "Show fewer"
                    : `Change selection · ${projects.length} recent projects`}
                </button>
              )}
              {data.totalRecent > projects.length && (
                <Link href={NAV.projects.href} className="ui-link-muted block text-xs mt-2">
                  All {data.totalRecent} recently active projects →
                </Link>
              )}
            </>
          )}
          {!data.githubChecked && (
            <p className="mt-2 text-xs text-text-muted">
              Based on the activity Loki can read; GitHub activity may be incomplete.
            </p>
          )}
        </>
      )}
      {failure && (
        <p className="ui-error mt-3" role="alert">
          {failure}{" "}
          <Link href={NAV.control.href} className="ui-link-muted">
            Check progress →
          </Link>
        </p>
      )}
      {result && (
        <div className="mt-3 space-y-1" role="status">
          <p className="text-sm text-text-primary">
            {result.kicked > 0
              ? `${result.kicked} project${result.kicked === 1 ? "" : "s"} queued. Follow progress in Control; results will appear in Activity.`
              : "No new work started."}
          </p>
          {result.kicked > 0 && (
            <p className="text-xs text-text-secondary">
              {result.details
                .filter((d) => d.outcome === "kicked")
                .map((d) => d.projectKey)
                .join(" · ")}
            </p>
          )}
          {result.details
            .filter((d) => d.outcome === "skipped")
            .map((d) => (
              <p key={d.projectKey} className="text-xs text-text-secondary">
                {d.projectKey}:{" "}
                {REASONS[d.reason ?? ""] ?? "Could not start — check Control for details"}
              </p>
            ))}
          <Link href={NAV.activity.href} className="ui-link-muted inline-flex ui-tap text-sm">
            See results →
          </Link>
        </div>
      )}
    </section>
  );
}
