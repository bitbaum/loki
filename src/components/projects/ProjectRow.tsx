"use client";

import Link from "next/link";
import { ChevronRight, ArrowRight } from "lucide-react";
import { StatusBadge, HealthBadge, getHealthSignals } from "./project-badges";
import { shortProjectStatus } from "@/lib/projects-display";
import type { ProjectGridRow } from "./project-grid-row";
import { cn } from "@/lib/utils";
import { deriveProjectLoopReadiness } from "@/lib/project-loop-readiness";
import { computeProjectHealth } from "@/lib/project-health";
import { HealthScoreBar } from "./HealthScore";
import { answer, cleanDescription } from "@/lib/project-display";
import { timeAgo } from "@/lib/dates";

/**
 * THE project row — every project renders through this one shape. The old
 * page bifurcated on a boolean: flagged projects became fat two-column cards,
 * everything else a bare 44px line, so the same object had two incompatible
 * looks and the list read as two unrelated widgets. One row, one grammar:
 * identity + badges on line one, the one context line under it, and a quiet
 * right-hand meta column (health, recency, open feedback) that answers "what
 * moved?" without opening the project.
 */
export function ProjectRow({
  project,
  lastDispatchAt,
  feedbackOpen,
}: {
  project: ProjectGridRow;
  /** Newest non-smoke dispatch for this project, ISO — null = never. */
  lastDispatchAt?: string | null;
  /** Open (new + dispatched) feedback items for this project. */
  feedbackOpen?: number;
}) {
  const { attrs } = project;
  const status = attrs["status"];
  const statusLabel = shortProjectStatus(status);
  const nextStep = answer(attrs["next_step"]);
  const description = cleanDescription(project.description) ?? answer(attrs["description"]);
  const signals = getHealthSignals(attrs, project.attrMeta);
  const siteDown = Boolean(project.liveUrl) && project.siteOk === false;
  const flagged = signals.length > 0 || siteDown;
  const line = nextStep ?? description;
  const loopReadiness = deriveProjectLoopReadiness(project);
  const health = computeProjectHealth({
    description: project.description,
    gitUrl: project.gitUrl,
    dirPath: project.dirPath,
    liveUrl: project.liveUrl,
    attrs,
  });

  const recency = lastDispatchAt
    ? `active ${timeAgo(new Date(lastDispatchAt).getTime())}`
    : "no runs yet";

  return (
    <div
      className={cn(
        "ui-projects-row group relative flex w-full min-h-11 items-center gap-3",
        flagged && "ui-projects-row-flagged",
      )}
    >
      <div className="min-w-0 flex-1 text-left">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* The name is the link, and its ::after covers the row — so the whole
              row is still one click target, while the row itself is no longer an
              <a> and may finally contain controls of its own. A screen reader
              now announces a link whose text is the project's name, instead of
              an aria-label bolted onto a wrapper. */}
          <Link
            href={`/projects/${project.id}`}
            className="ui-projects-row-link truncate text-sm font-medium text-text-primary"
          >
            {project.name}
          </Link>
          {project.readonly && <span className="ui-projects-badge shrink-0">Team</span>}
          {statusLabel && <StatusBadge value={statusLabel} />}
          {siteDown && <span className="ui-projects-badge ui-projects-badge-negative">Down</span>}
          {signals.map((s) => (
            <HealthBadge key={s.kind} signal={s} />
          ))}
          {/* Not desktop-only. "Needs path" means Loki cannot dispatch an agent
              for this project at all — the most actionable badge on the row,
              and it was hidden on the viewport where the row is narrowest. */}
          {loopReadiness.state !== "ready" && (
            <span
              className="ui-projects-badge ui-projects-badge-warning"
              title={loopReadiness.description}
            >
              {loopReadiness.label}
            </span>
          )}
        </div>
        {/* Two lines, not one ellipsis.

            This page's own header says "Decide what needs your attention now",
            and the next step is the only content on the row that supports that
            decision — yet it was `truncate`d to a single line showing 21–36% of
            the sentence, with the remainder available on hover only. A phone
            has no hover, so on the viewport where the row is narrowest the
            deciding information was simply unreadable. Measured across all four
            widths by audit:responsive, which flags prose under 50% visible.

            `truncate` has to come off the PARENT too: it sets
            `white-space: nowrap`, which would stop the child wrapping no matter
            what the child says. min-w-0 lets the span shrink inside the flex
            row instead of overflowing it. */}
        {line && (
          <p className="mt-0.5 flex items-start gap-1.5 text-xs text-text-tertiary">
            {nextStep && (
              <ArrowRight
                className="mt-0.5 h-3 w-3 shrink-0 text-status-positive"
                aria-hidden="true"
              />
            )}
            <span className="line-clamp-2 min-w-0" title={line}>
              {line}
            </span>
          </p>
        )}
        {/* The same facts, on the viewport that had none of them.

            The right-hand meta column below is `sm:flex`, so on a phone the row
            lost health, "active … ago" and the open-feedback count outright.
            That became indefensible the moment this page started SORTING by
            recency and saying so in its subtitle: the order was unverifiable on
            the device where it matters most — you were asked to trust a
            sequence whose evidence had been hidden.

            A stacked line rather than the desktop column: at 390px a right rail
            steals the width the project name needs, and the name is what you
            came to read. `health N/10` is spelled out because a bare "7/10"
            next to a date is a magic number — the score's own module exists to
            stop it being one. */}
        <p className="mt-1 text-micro text-text-muted sm:hidden">
          {recency}
          {` · health ${health.score}/${health.max}`}
          {feedbackOpen ? ` · ${feedbackOpen} feedback` : ""}
        </p>
      </div>
      {/* Above the stretched link, so the chip takes its own clicks.
          `interactive` was always supported by HealthScoreBar — a real button,
          an aria-expanded disclosure naming each missing point, inline edits,
          and an AI draft-from-the-brief action. None of it could be used here
          while the row was an <a>, so the list rendered the dead <span> with a
          hover title: on touch and to a screen reader, a bare "7/10". */}
      <div className="ui-projects-row-actions hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <HealthScoreBar
          health={health}
          interactive
          projectId={project.id}
          userProjectId={project.userProjectId}
          /* The CLEANED description, never the raw column: the bulk-import
             placeholder ("Local repository imported from loki-ui") is not a
             brief, and the gap-fill would happily draft a mission from it.
             eslint's no-restricted-syntax rule here caught exactly that. */
          brief={description}
        />
        <span className="text-micro text-text-muted">
          {recency}
          {feedbackOpen ? ` · ${feedbackOpen} feedback` : ""}
        </span>
      </div>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary"
        aria-hidden="true"
      />
    </div>
  );
}
