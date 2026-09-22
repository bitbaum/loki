"use client";

import Link from "next/link";
import { getHealthSignals } from "./project-badges";
import type { ProjectGridRow } from "./project-grid-row";
import { cn } from "@/lib/utils";
import { deriveProjectLoopReadiness } from "@/lib/project-loop-readiness";
import { computeProjectHealth } from "@/lib/project-health";
import { HealthScoreBar } from "./HealthScore";
import { answer, cleanDescription, hasAnswer } from "@/lib/project-display";
import { timeAgo } from "@/lib/dates";
import { resolveProjectStage } from "@/lib/constants/statuses";

/**
 * THE project row.
 *
 * Rebuilt 2026-09-22, after George's read of the old one: "they don't look like
 * integral elements, rather like ones where random subelements are thrown in,
 * which results in unaligned subelements and generally bad looking stuff."
 * That was accurate, and it was accretion — every fix through the day had
 * added a part, and nobody had ever designed the parts together.
 *
 * ONE GRAMMAR, and it fits in a sentence: identity on the left, a fixed data
 * rail on the right, one row height for every project.
 *
 * What went, and why:
 *
 *   · A BADGE PER FACT. Stage, up to three flags with ages, "Needs path",
 *     "Team" — a row was between two and seven coloured chips, so every row
 *     was a different shape and the page read as chip soup. Colour is now
 *     spent only on flags, the one thing here that is genuinely an alarm.
 *   · THE SEGMENTED BAR. It had the shape of a meter and the content of a
 *     checklist; the score says the same thing in four characters.
 *   · THE CHEVRON. Decoration on a link the entire row already is.
 *   · THE ARROW before the description, repeated on all 25 rows.
 *   · CONTENT-SIZED COLUMNS. Measured on prod: the health chip's left edge
 *     moved 37px between rows and three different row heights (71/79/81px)
 *     meant nothing lined up vertically either.
 *
 * The rail is what makes this a list instead of 25 widgets: fixed column
 * widths and tabular numbers, so stage / flags / health / last run run in
 * straight lines down the page.
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
  const signals = getHealthSignals(attrs, project.attrMeta);
  const siteDown = Boolean(project.liveUrl) && project.siteOk === false;
  const flagCount = signals.length + (siteDown ? 1 : 0);
  const flagged = flagCount > 0;

  const nextStep = answer(attrs["next_step"]);
  const description = cleanDescription(project.description) ?? answer(attrs["description"]);
  const context = nextStep ?? description;

  const loopReadiness = deriveProjectLoopReadiness(project);
  const health = computeProjectHealth({
    description: project.description,
    gitUrl: project.gitUrl,
    dirPath: project.dirPath,
    liveUrl: project.liveUrl,
    attrs,
  });

  const stage = resolveProjectStage(attrs["status"]);
  // "last run", never "active": this is the newest AGENT dispatch, and calling
  // it activity told the operator he had worked on something he had not
  // touched in months.
  const lastRun = lastDispatchAt ? timeAgo(new Date(lastDispatchAt).getTime()) : null;
  const lastRunShort = lastRun?.replace(/\s*ago$/, "") ?? "—";

  /** What the flags cell says, in as few characters as carry the meaning. */
  const flagLabel = flagged ? `${flagCount} flag${flagCount > 1 ? "s" : ""}` : "";
  /** Every flag's text, so hovering the count answers "which?" without a click. */
  const flagTitle = [
    ...signals.map((s) => `${s.label}: ${s.value}`),
    ...(siteDown ? ["Site is down"] : []),
  ].join("\n\n");

  return (
    <div
      className={cn(
        "ui-projects-row group relative",
        // The only colour a row carries. A flagged project gets a rail on its
        // edge instead of three red chips in its middle.
        flagged && "ui-projects-row-flagged",
      )}
    >
      <div className="min-w-0 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* The name is the link; its ::after covers the row, so the whole
              row stays one target while the row itself can hold controls. */}
          <Link
            href={`/projects/${project.id}`}
            className="ui-projects-row-link ui-projects-row-name"
          >
            {project.name}
          </Link>
          {project.readonly && (
            <span className="shrink-0 text-micro uppercase tracking-caps text-text-muted">
              team
            </span>
          )}
          {loopReadiness.state !== "ready" && (
            <span
              className="shrink-0 text-micro uppercase tracking-caps text-status-warning"
              title={loopReadiness.description}
            >
              {loopReadiness.label}
            </span>
          )}
        </div>

        {context && <p className="ui-projects-row-context">{context}</p>}

        {/* Mobile: the same four facts, same order, stacked. */}
        <p className="ui-projects-row-meta">
          {stage && <span className="uppercase tracking-caps">{stage}</span>}
          {flagged && <span className="font-medium text-status-warning">{flagLabel}</span>}
          <span>
            {health.score}/{health.max}
          </span>
          <span>{lastRun ? `run ${lastRunShort}` : "never run"}</span>
          {feedbackOpen ? <span>{feedbackOpen} feedback</span> : null}
        </p>
      </div>

      {/* The rail. Fixed widths; the health cell is the one control. */}
      <div className="ui-projects-rail">
        <span className="ui-projects-rail-stage" title={stage ? undefined : attrs["status"]}>
          {stage ?? (hasAnswer(attrs["status"]) ? "—" : "")}
        </span>
        <span className="ui-projects-rail-flags" title={flagTitle || undefined}>
          {flagLabel}
        </span>
        <span className="ui-projects-rail-health ui-projects-row-actions">
          <HealthScoreBar
            health={health}
            interactive
            compact
            projectId={project.id}
            userProjectId={project.userProjectId}
            brief={description}
          />
        </span>
        <span
          className="ui-projects-rail-run"
          title={lastRun ? `Last agent run ${lastRun}` : "No agent has run here"}
        >
          {lastRunShort}
        </span>
      </div>
    </div>
  );
}
