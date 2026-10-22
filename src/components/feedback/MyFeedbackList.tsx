"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { compactRelativeDate } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import type { ReporterFeedbackRow } from "@/lib/feedback/attach-reporter-view";
import { ReporterFeedbackCard } from "./ReporterFeedbackCard";
import { OwnerFeedbackActions } from "./OwnerFeedbackActions";

/**
 * /my-feedback as rows: what you reported (your words, one line), where it
 * has got to and on which project (one grey line), when. A report that waits
 * on you ("Ready for you") carries the one amber dot. Tapping a row opens it
 * — the whole report, what is happening, and the one thing you can do — in a
 * sheet drawn by ReporterFeedbackCard, the same piece the tracking link
 * shows a visitor without an account, so the two cannot drift.
 */
export function MyFeedbackList({
  rows,
  ownProjectIds,
}: {
  rows: ReporterFeedbackRow[];
  /** Projects the reader can also edit: those reports get the owner's moves. */
  ownProjectIds: string[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = rows.find((r) => r.id === openId) ?? null;

  if (rows.length === 0) {
    return <EmptyState icon={MessageSquare} title="Reports you send from a site show up here" />;
  }

  return (
    <>
      <List aria-label="Your reports">
        {rows.map((row) => (
          <ListRow
            key={row.id}
            onClick={() => setOpenId(row.id)}
            title={oneLine(row.suggestion)}
            status={row.status.tone === "warning" ? "warning" : undefined}
            secondary={`${row.status.label} · ${projectTitle({ name: row.projectName })}`}
            trailing={compactRelativeDate(row.createdAt)}
          />
        ))}
      </List>
      {opened &&
        createPortal(
          <Modal
            onClose={() => setOpenId(null)}
            size="lg"
            position="bottom-mobile"
            padded={false}
            className="flex flex-col"
          >
            <div className="ui-prompt-sheet-head">
              <h2 className="ui-prompt-sheet-title">{opened.status.label}</h2>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="ui-topbar-btn shrink-0"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="ui-prompt-sheet-body">
              <ReporterFeedbackCard row={opened} bare>
                {ownProjectIds.includes(opened.projectId) && (
                  <OwnerFeedbackActions
                    feedbackId={opened.id}
                    projectId={opened.projectId}
                    canStart={opened.canStart}
                  />
                )}
              </ReporterFeedbackCard>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}

/** The report as a row's title: its first words, on one line. */
function oneLine(text: string): string {
  return text.split(/\s*---\s*technical details/i)[0]!.replace(/\s+/g, " ").trim() || "A report";
}
