import type { ActivityEvent } from "@/lib/activity-events";
import { taskTitle } from "@/lib/task-title";
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
  // The runner's own sentence opens "launched claude (pty) + injected, but Loki
  // could not verify generation", which reached the page as it was
  // (2026-11-11). The cause is what follows it, so the specific ones go first.
  if (/not authenticated|login required|please run \/login|\b401\b/.test(lower))
    return "The agent is signed out. Sign it in from the Terminal.";
  if (/container failed to start|exited before printing anything/.test(lower))
    return "The builder could not start the agent.";
  if (/could not verify generation|produced no response|inject did not stick/.test(lower))
    return "The agent opened but never answered.";
  if (/no running agent|could not (be )?start|never started|not delivered/.test(lower))
    return "The agent did not start.";
  if (/usage limit|quota|rate limit|credit/.test(lower)) return "The AI provider's limit ran out.";
  // The rest the owner read raw on 2026-11-12: a full builder, a missing
  // folder, an exit code, a cancel, and a replaced request.
  if (/already open on the|as many as it runs at once|no free (slot|session)/.test(lower))
    return "Too many tasks were running at once. Run it again when one finishes.";
  if (/cwd does not exist|no such file or directory/.test(lower))
    return "The project's folder is missing on the builder.";
  if (/exited \(code|process exited/.test(lower)) return "The agent quit unexpectedly.";
  if (/stopped waiting/.test(lower)) return "You cancelled it before it started.";
  if (/superseded/.test(lower)) return "Replaced by a newer request.";
  if (/timed out|timeout/.test(lower) || event.outcome === "timeout") return "It ran out of time.";
  if (event.outcome === "hang") return "It stopped answering.";
  if (event.outcome === "unconfirmed") return "Sent, but the agent never confirmed it.";
  if (!raw) return "It failed without saying why.";
  // An unknown cause is the builder's own text — paths, codes, flags. Watch
  // shows it in full; the feed says where to look.
  return "It failed — open it to see why.";
}

/** One line for a row in the feed: how it went, then what came of it. */
export function eventLine(event: ActivityEvent): string {
  const outcome = event.outcomeLabel;
  if (event.status === "negative") return `${outcome} · ${plainFailure(event)}`;
  // What it is, the way Home titles it (lib/task-title) — never the raw
  // instructions sent to the agent, flags and URLs included (2026-11-12).
  const what = event.done ?? taskTitle(event.ask?.task ?? event.ask?.preview, event.intentId);
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
