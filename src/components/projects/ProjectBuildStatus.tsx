/**
 * The first thing on a project's Now tab: is something being built, and if
 * not, the one button that starts it.
 *
 * Server component on purpose. Every line here is relative time ("started 9m
 * ago"), and rendering that in a client component hydrates against a second
 * clock. The button is the only interactive part and lives in
 * ProjectActionButtons.
 *
 * Copy rule: say what is known, from the run ledger and the runner's last
 * observation, and nothing else. "Building now" needs a fresh observation;
 * "timed out after 1h 44m, nothing reached the repo" needs the run row and
 * the commit list. See lib/project-build-status for what each state requires.
 */
import Link from "next/link";
import { Rocket } from "lucide-react";
import type { BuildStatus } from "@/lib/project-build-status";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { timeAgo, formatDurationMinutes } from "@/lib/dates";
import { MakeItHappenButton } from "./ProjectActionButtons";

const OUTCOME_VERB: Record<string, string> = {
  success: "finished",
  partial: "finished partially",
  user_abort: "was stopped",
  error: "failed",
  hang: "hung",
  timeout: "timed out",
};

export function ProjectBuildStatus({
  status,
  projectId,
  workspaceKey,
  readonly,
  setupNeeded,
  hasNextStep,
}: {
  status: BuildStatus;
  projectId: string;
  workspaceKey: string;
  readonly: boolean;
  /** The kickoff hero renders right below with its own Make it happen — when
   *  it does, this strip reports state and offers no second button. */
  setupNeeded: boolean;
  /** A queued next step exists, so the button runs it; otherwise it briefs an
   *  agent from the description (the kickoff prompt). */
  hasNextStep: boolean;
}) {
  // Setup still missing and nothing running: the hero below already says
  // "nothing built yet, press here". A second card saying the same thing on
  // top of it is the two-CTA layout this strip exists to remove.
  if (setupNeeded && status.kind === "idle") return null;

  const canStart = !readonly && !setupNeeded;
  const tone =
    status.kind === "building" || status.kind === "queued"
      ? "ui-dot-positive"
      : status.kind === "stalled"
        ? "ui-dot-warning"
        : "ui-dot-neutral";

  let headline: string;
  let detail: string;
  let action: React.ReactNode = null;

  switch (status.kind) {
    case "building": {
      headline = "Building now";
      detail = [status.label, status.sinceMs != null ? `started ${timeAgo(status.sinceMs)}` : null]
        .filter(Boolean)
        .join(" · ");
      if (!detail) detail = "An agent is working on this project.";
      action = (
        <Link
          href={fleetSurfaceHref("terminal", workspaceKey)}
          className="ui-btn-secondary min-h-11 gap-2"
        >
          <Rocket className="h-4 w-4" aria-hidden="true" /> Watch it work
        </Link>
      );
      break;
    }
    case "queued": {
      headline = "Starting up";
      detail = `Sent ${timeAgo(status.sinceMs)}. Waiting for a builder to claim it — watch Terminal or Control.`;
      action = (
        <Link
          href={fleetSurfaceHref("control", workspaceKey)}
          className="ui-btn-secondary min-h-11"
        >
          Follow in Control
        </Link>
      );
      break;
    }
    case "stalled": {
      headline = `Sent ${timeAgo(status.sinceMs)}, but no agent has picked it up`;
      detail = "Nothing has been recorded for that request, so starting again is safe.";
      break;
    }
    case "idle": {
      headline = "Nothing is being built right now";
      const last = status.last;
      if (!last) {
        detail = "No build has been started yet.";
      } else {
        const verb = OUTCOME_VERB[last.outcome] ?? last.outcome;
        const landed = last.landed ? "work reached the repo" : "nothing reached the repo";
        detail =
          last.outcome === "success"
            ? `Last run finished ${timeAgo(last.finishedAtMs)} after ${formatDurationMinutes(last.durationMinutes)} — ${landed}.`
            : `Last attempt ${verb} ${timeAgo(last.finishedAtMs)} after ${formatDurationMinutes(last.durationMinutes)} — ${landed}.`;
      }
      break;
    }
  }

  if (canStart && (status.kind === "idle" || status.kind === "stalled")) {
    action = (
      <MakeItHappenButton
        projectId={projectId}
        workspaceKey={workspaceKey}
        kind={hasNextStep ? "next_step" : "kickoff"}
      />
    );
  }

  return (
    <section
      className="ui-card-shell flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      aria-labelledby="project-build-status-title"
    >
      <div className="min-w-0">
        <p className="ui-kicker">Build</p>
        <h2
          id="project-build-status-title"
          className="mt-1 flex items-center gap-2 text-lg font-semibold text-text-primary"
        >
          <span className={`ui-dot ${tone}`} aria-hidden="true" />
          {headline}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">{detail}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}
