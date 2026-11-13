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
  // The rest of the builder's own sentences live on 2026-11-12.
  // Before the runner check: "you stopped waiting … after no runner picked it up".
  if (/stopped waiting/.test(lower)) return "You cancelled it before it started.";
  if (isCapacityFailure(event))
    return "Too many tasks were running at once. Run it again when one finishes.";
  if (/no runner picked it up|no runner (is )?(online|available|claimed)/.test(lower))
    return "No computer was free to take it.";
  if (/cwd does not exist|no such file or directory/.test(lower))
    return "The project folder is missing on that computer.";
  if (/exited \(code \d+\)|process exited|killed by signal/.test(lower))
    return "The agent stopped partway.";
  if (/^superseded\b/.test(lower)) return "Replaced by a newer request.";
  if (/timed out|timeout/.test(lower) || event.outcome === "timeout") return "It ran out of time.";
  if (event.outcome === "hang") return "It stopped answering.";
  if (event.outcome === "unconfirmed") return "Sent, but the agent never confirmed it.";
  if (!raw) return "It failed without saying why.";
  // An unknown cause is the builder's own text — paths, codes, flags. Watch
  // shows it in full; the feed says where to look.
  return "It failed — open it to see why.";
}

/** "8 agent sessions are already open on the cloud builder, which is as many
 *  as it runs at once." Running it again only meets the same full builder. */
export function isCapacityFailure(event: Pick<ActivityEvent, "error">): boolean {
  return /as many as it runs at once|at capacity|too many (open|concurrent) sessions/i.test(
    event.error ?? "",
  );
}

/** A routing note the dispatcher writes ahead of the brief, in capitals:
 *  "QUEUE BEHIND CURRENT WORK (from Grok Bot for G / Cato). Finish what…". */
const ROUTING_NOTE = /^[A-Z][A-Z ,'’/-]{4,}(?:\([^)]*\)|[^\n])*?[.:!](?=\s|$)\s*/;

/**
 * One line a person can read, out of text an agent or a dispatcher wrote: its
 * first sentence, with the parts that mean nothing on a phone taken out —
 * links and session ids, commit hashes, setting names (CRON_SECRET), file
 * paths and leading routing notes. Rows read like a log otherwise (2026-11-12).
 */
export function plainLine(text: string, max = 140): string {
  let line = text
    .replace(/https?:\/\/[^\s)]*[^\s).,;:!?]/g, "")
    .replace(/\bsession_[A-Za-z0-9]+\b/g, "")
    .replace(ROUTING_NOTE, "")
    .trim();
  line = (line.split(/(?<=[.!?])\s/)[0] ?? line)
    .replace(/\b(?:commit:?\s*)?(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi, "")
    .replace(/\b(?:(?:the|a|an) )?[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, "a setting")
    .replace(/(?:~|\.)?(?:\/[\w.@-]+){2,}\/?/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/[\s:;,·—–-]+$/g, (end) => (end.includes(".") ? "." : ""))
    .replace(/\s{2,}/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** One line for a row in the feed: how it went, then what came of it. */
export function eventLine(event: ActivityEvent): string {
  const outcome = event.outcomeLabel;
  if (event.status === "negative") return `${outcome} · ${plainFailure(event)}`;
  // What it is, the way Home titles it (lib/task-title) — never the raw
  // instructions sent to the agent, flags and URLs included (2026-11-12).
  const what = event.done
    ? plainLine(event.done) || taskTitle(event.ask?.task ?? event.ask?.preview, event.intentId)
    : taskTitle(event.ask?.task ?? event.ask?.preview, event.intentId);
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
