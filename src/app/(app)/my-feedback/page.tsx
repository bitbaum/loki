import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { requirePageUserId } from "@/lib/session";
import { listReporterFeedback } from "@/db/queries/site-feedback";
import { attachReporterView } from "@/lib/feedback/attach-reporter-view";
import { reporterToneClass } from "@/lib/feedback/reporter-view";
import { PageLayout } from "@/components/ui/page-layout";
import { FeedbackReportText } from "@/components/feedback/FeedbackReportText";
import { ReportedTime } from "@/components/feedback/ReportedTime";

export const metadata = { title: "My feedback" };

/**
 * The reporter's side of the feedback loop — the only feedback surface whose
 * reader may be a stranger on someone else's site.
 *
 * It renders through the SAME pieces as the operator inbox on purpose. It used
 * to have its own row markup, and the divergence was not theoretical: the
 * three-line clamp shipped to FeedbackItemRow in #783 — in answer to a report
 * filed FROM this page — and never reached here, so the person who asked for
 * it went on seeing their own eight-line report swallow the list while its
 * status read "Being implemented".
 *
 * Status is derived, never the raw DB word: see lib/feedback/reporter-view.ts
 * for what a reporter is told and what stays the operator's.
 */
export default async function MyFeedbackPage() {
  const userId = await requirePageUserId();
  const rows = await attachReporterView(await listReporterFeedback(userId));

  return (
    <PageLayout
      title="My feedback"
      subtitle="Reports you submitted, and where each one has got to."
      maxWidth="max-w-4xl"
    >
      {rows.length === 0 ? (
        <div className="ui-empty-page">No claimed feedback yet.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="ui-card-shell space-y-2 p-4">
              {/* The report leads, alone and clamped — same order as the
                  operator row, so one report reads the same to both people. */}
              <FeedbackReportText text={row.suggestion} />

              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
                <span className={cn("ui-tag shrink-0", reporterToneClass(row.status.tone))}>
                  {row.status.label}
                </span>
                {/* Labelled, because an unlabelled project name sat exactly
                    where a person's name would and read as one. */}
                <span className="text-text-muted">
                  on {row.projectName} · <ReportedTime at={row.createdAt.toISOString()} />
                </span>
              </p>

              <p className="text-sm text-text-secondary">{row.status.detail}</p>

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
            </article>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
