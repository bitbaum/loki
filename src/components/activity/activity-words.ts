import type { ActivityEvent } from "@/lib/activity-events";
import type { ProjectNames } from "./activity-shared";

/**
 * What went wrong, the way a person would say it (design reset rule 9).
 * The builder's own errors reached the page verbatim — "no running agent for
 * 'substrata' on this runner" — so the one line a failure gets now names the
 * cause in plain words when it is a known one, and keeps the agent's own
 * first sentence when it is not (Watch has the rest).
 */
export function plainFailure(event: Pick<ActivityEvent, "error" | "outcome">): string {
  const raw = event.error?.trim() ?? "";
  const lower = raw.toLowerCase();
  if (/no running agent|could not (be )?start|never started|not delivered/.test(lower))
    return "The agent did not start.";
  if (/usage limit|quota|rate limit|credit/.test(lower)) return "The AI provider's limit ran out.";
  if (/timed out|timeout/.test(lower) || event.outcome === "timeout") return "It ran out of time.";
  if (event.outcome === "hang") return "It stopped answering.";
  if (event.outcome === "unconfirmed") return "Sent, but the agent never confirmed it.";
  if (!raw) return "It failed without saying why.";
  const first = raw.split(/(?<=[.!?])\s/)[0] ?? raw;
  return first.length > 140 ? `${first.slice(0, 139)}…` : first;
}

/** One line for a row in the feed: how it went, then what came of it. */
export function eventLine(event: ActivityEvent): string {
  const outcome = event.outcomeLabel;
  if (event.status === "negative") return `${outcome} · ${plainFailure(event)}`;
  const what = event.done ?? event.ask?.preview ?? event.intentLabel;
  return what ? `${outcome} · ${what}` : outcome;
}

/** Where a row opens: its run on the project's Watch page, else its session. */
export function watchHref(
  event: Pick<ActivityEvent, "projectKey" | "runId">,
  names: ProjectNames,
): string {
  const id = names[event.projectKey]?.id;
  if (id) return `/projects/${id}/watch${event.runId ? `?run=${event.runId}` : ""}`;
  return `/terminal?project=${encodeURIComponent(event.projectKey)}`;
}
