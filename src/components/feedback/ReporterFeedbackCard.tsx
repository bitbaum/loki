import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { projectTitle } from "@/lib/project-display";
import { reporterToneClass } from "@/lib/feedback/reporter-view";
import type { ReporterFeedbackRow } from "@/lib/feedback/attach-reporter-view";
import { FeedbackReportText } from "./FeedbackReportText";
import { ReportedTime } from "./ReportedTime";
import { GoLiveButton } from "./GoLiveButton";

/**
 * One report as the person who wrote it sees it: their words, where it has
 * got to, and the one thing they can do next. Shared by /my-feedback and the
 * tracking link a visitor opens without an account, so the two cannot drift
 * (the reason /my-feedback renders through FeedbackReportText at all).
 */
export function ReporterFeedbackCard({
  row,
  bare = false,
  children,
}: {
  row: ReporterFeedbackRow;
  /** Inside a sheet (/my-feedback): no box of its own around it. */
  bare?: boolean;
  /** What only some readers get (the owner's own way forward). */
  children?: ReactNode;
}) {
  return (
    <article className={bare ? "space-y-3" : "ui-card-shell space-y-2 p-4"}>
      {/* The report leads, alone and clamped — same order as the operator
          row, so one report reads the same to both people. */}
      <FeedbackReportText text={row.suggestion} />

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
        {/* In a sheet the status is the sheet's own title. */}
        {!bare && (
          <span className={cn("ui-tag shrink-0", reporterToneClass(row.status.tone))}>
            {row.status.label}
          </span>
        )}
        {/* Labelled, because an unlabelled project name sat exactly where a
            person's name would and read as one. */}
        <span className="text-text-muted">
          on {projectTitle({ name: row.projectName })} ·{" "}
          <ReportedTime at={row.createdAt.toISOString()} />
        </span>
      </p>

      <p className="text-sm text-text-secondary">{row.status.detail}</p>

      {row.status.goLive && <GoLiveButton feedbackId={row.id} />}
      {row.status.action && (
        <a
          href={row.status.action.href}
          target="_blank"
          rel="noreferrer"
          className="ui-btn-secondary inline-flex items-center gap-1.5"
        >
          {row.status.action.label}
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </a>
      )}
      {children}
    </article>
  );
}
