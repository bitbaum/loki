"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ListChecks, Play } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { useFetch } from "@/hooks/use-fetch";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { NAV } from "@/config/navigation";
import { trackUsage } from "@/lib/usage/track";
import { projectTitle } from "@/lib/project-display";
import type { DayPlan } from "@/lib/start-my-day/rank";
import type { FleetKickResult } from "@/lib/fleet-kick";

const ENDPOINT = "/api/control/start-my-day";
const SURFACE = "loki.start-my-day";
const REASONS: Record<string, string> = {
  paused: "Paused — open the project to resume",
  no_path: "Needs a repository or folder — open the project to connect it",
  pending_command: "Already queued",
  busy: "Already working",
  concurrency_cap: "All work slots are in use — try again when one finishes",
  blocked: "Needs attention — open Control",
};

/** One small selection, shared by the actual front door and the fresh chat.
 * No AI call to rank it, and no launch on mount or refresh. */
export function StartMyDay({ onlyWithWork = false }: { onlyWithWork?: boolean } = {}) {
  const { data, loading, error, refetch } = useFetch<DayPlan>(ENDPOINT);
  // null means the suggested default; [] means the person deselected everything.
  const [selection, setSelection] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [result, setResult] = useState<FleetKickResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [lastStarted, setLastStarted] = useState<{ id: string; name: string; href: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [mainIds, setMainIds] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const projects = data?.projects ?? [];
  const selected = (selection ?? data?.selectedIds ?? []).filter((id) =>
    projects.some((p) => p.id === id && !p.unavailable && !accepted.includes(p.id)),
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
      const body = (await response.json()) as { result: FleetKickResult; startedIds: string[] };
      setResult(body.result);
      setLastStarted(
        body.startedIds.flatMap((id) => {
          const project = projects.find((p) => p.id === id);
          return project ? [{ id: project.id, name: project.name, href: project.href }] : [];
        }),
      );
      setAccepted((prev) => [...new Set([...prev, ...body.startedIds])]);
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

  function editProjects() {
    setMainIds((data?.catalog ?? []).filter((p) => p.main).map((p) => p.id));
    setLabels(data?.labels ?? {});
    setQuery("");
    setEditing(true);
    setFailure(null);
  }
  async function saveProjects() {
    setBusy(true);
    setFailure(null);
    try {
      // Send only changed labels; preserve saved names for projects outside this edit.
      const names = Object.fromEntries(Object.entries(labels).filter(([, label]) => label.trim()));
      const response = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainProjectIds: mainIds, labels: names }),
      });
      if (!response.ok) await throwApiError(response, "Could not save your main projects.");
      setSelection(null);
      setEditing(false);
      refetch();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not save projects.");
    } finally {
      setBusy(false);
    }
  }

  // On the chat's start screen the card earns its place only with projects to
  // start: "choose your main projects" is setup, and it is Today's job. On
  // the phone it stood between the person and the question "What are we
  // working on?" (owner's walk-through, 2026-10-17).
  if (onlyWithWork && (!data || error || projects.length === 0)) return null;
  // Nothing to say until it knows; then, with no main projects chosen, the
  // whole block is ONE row (design reset rule 2, 2026-10-22). It was a
  // heading, an explanation paragraph and a bordered button.
  if (!data && !error) return null;
  if (data && !error && projects.length === 0 && !editing && !failure) {
    return (
      <div data-start-my-day>
        <List aria-label="Start my day">
          <ListRow
            icon={ListChecks}
            title="Choose your main projects"
            secondary="Loki picks up the next useful task in each"
            onClick={editProjects}
            chevron
          />
        </List>
      </div>
    );
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
        Choose the projects that matter to you. Loki picks up the next useful task in each one.
      </p>
      {loading && !data && (
        <p className="mt-3 text-sm text-text-muted" role="status">
          Loading your projects…
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
          <button
            type="button"
            className="ui-btn-secondary mt-3"
            onClick={editProjects}
            disabled={busy}
          >
            Choose main projects
          </button>
          {editing && (
            <div className="mt-3 space-y-3" aria-label="Your main projects">
              <p className="text-sm text-text-secondary">
                Main projects stay here even when quiet, including projects shared with you. Names
                you set here are personal labels; repositories and other members&apos; names stay
                unchanged.
              </p>
              <input
                className="ui-input w-full"
                aria-label="Find an available project"
                placeholder="Find a project…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="max-h-80 overflow-y-auto space-y-3">
                {(data.catalog ?? [])
                  .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
                  .map((p) => (
                    <li key={p.id} className="min-w-0">
                      <label className="flex gap-2 items-center ui-tap min-w-0">
                        <input
                          type="checkbox"
                          checked={mainIds.includes(p.id)}
                          disabled={busy}
                          onChange={() =>
                            setMainIds((prev) =>
                              prev.includes(p.id)
                                ? prev.filter((id) => id !== p.id)
                                : [...prev, p.id],
                            )
                          }
                        />
                        <span className="break-words min-w-0 text-sm">{p.name}</span>
                      </label>
                      <input
                        className="ui-input w-full"
                        aria-label={`Your name for ${p.name}`}
                        maxLength={100}
                        value={labels[p.id] ?? p.name}
                        onChange={(e) => setLabels((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        disabled={busy}
                      />
                      {p.unavailable && (
                        <p className="text-xs text-text-secondary">{p.unavailable}</p>
                      )}
                      <Link href={p.href} className="ui-link-muted inline-flex ui-tap text-xs">
                        Project details and settings →
                      </Link>
                    </li>
                  ))}
              </ul>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="ui-btn-primary"
                  disabled={busy}
                  onClick={() => void saveProjects()}
                >
                  {busy ? "Saving…" : "Save main projects"}
                </button>
                <button
                  type="button"
                  className="ui-btn-ghost"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {/* Nothing chosen yet: the line above and the button already say
              it. A third sentence ("Choose your main projects above…") and a
              "Choose a project →" link that went to a different page are
              what the card read as on the live demo (2026-10-17). */}
          {projects.length === 0 ? null : (
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
                Up to {data.maxProjects} projects at once. Recent activity alone does not select
                projects for you. Existing autopilot settings still apply.
              </p>
              <ul className="mt-3 space-y-2">
                {visible.map((p) => {
                  const submitted = accepted.includes(p.id);
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
                            {projectTitle({ name: p.name })}
                          </span>
                          <span className="text-xs text-text-muted">{p.why}</span>
                          {p.unavailable && !submitted && (
                            <span className="text-xs text-text-secondary">{p.unavailable}</span>
                          )}
                        </span>
                      </label>
                      {p.unavailable || submitted ? (
                        <Link href={p.href} className="ui-btn-ghost shrink-0">
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
                  {expanded ? "Show fewer" : `Change selection · ${projects.length} projects`}
                </button>
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
              ? `${result.kicked} project${result.kicked === 1 ? "" : "s"} queued. Open a project to follow progress.`
              : "No new work started."}
          </p>
          {result.kicked > 0 && (
            <ul className="space-y-1 text-sm">
              {lastStarted.map((p) => (
                <li key={p.id}>
                  <Link href={p.href} className="ui-link-muted inline-flex ui-tap">
                    {projectTitle({ name: p.name })} →
                  </Link>
                </li>
              ))}
            </ul>
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
