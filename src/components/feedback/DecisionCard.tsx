"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { RECOMMEND, type Recommendation } from "@/lib/feedback/recommend";
import type { FeedbackListItemWithWork } from "@/lib/feedback/attach-work";
import { FeedbackItemRow } from "@/components/feedback/FeedbackItemRow";
import { compactRelativeDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * One decision Loki has already made, waiting for a yes.
 *
 * The card leads with the tap (Loki's recommendation, as a verb) and the
 * reason in one sentence; the report itself is under them in smaller type,
 * for the reader who has time. One filled button is the yes. "Something
 * else" opens the full row — every other move, the walkthrough, the
 * terminal — for the reader who disagrees. Nothing on the card needs to be
 * read for the tap to be right: that is the contract the recommendation
 * engine (lib/feedback/recommend.ts) signs.
 */
export function DecisionCard({
  item: f,
  rec,
  busy,
  taken,
  project,
  onTake,
  rowProps,
}: {
  item: FeedbackListItemWithWork & { projectName: string; projectId: string };
  rec: Recommendation;
  busy: boolean;
  /** Just taken, on this screen: the card says so and fades. */
  taken: boolean;
  project: { id: string; name: string } | null;
  onTake: () => void;
  rowProps: Parameters<typeof FeedbackItemRow>[0] extends infer P
    ? Omit<P, "feedback" | "projectName" | "project" | "busy">
    : never;
}) {
  const [other, setOther] = useState(false);
  const cost = rec.runs ? "one agent run" : "free";
  return (
    <article className={cn("ui-fb-decision", taken && "ui-fb-decision-taken")}>
      <p className="ui-fb-decision-kicker">
        {kindWord(rec)} · {cost}
      </p>
      <p className="ui-fb-decision-why">{rec.why}</p>
      <p className="ui-fb-decision-report">
        <span className="ui-fb-decision-quote">“{excerpt(f.suggestion)}”</span>
        <span className="ui-fb-decision-where">
          {" "}
          — {project ? `${project.name} · ` : ""}
          {f.page && f.page !== "/" ? f.page : "home"} · {compactRelativeDate(f.createdAt)}
        </span>
      </p>
      <div className="ui-fb-decision-actions">
        {taken ? (
          <span className="ui-fb-decision-done">Done — {rec.label.toLowerCase()}</span>
        ) : rec.kind === RECOMMEND.CONNECT ? (
          <Link href={`/projects/${f.projectId}`} className="ui-btn-save">
            {rec.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onTake}
            disabled={busy}
            className="ui-btn-save"
            title={
              rec.runs ? "Starts one agent run on your builder" : "Free — one tap brings it back"
            }
          >
            {busy && <Loader2 className="ui-spinner-xs" />}
            {rec.label}
          </button>
        )}
        {!taken && (
          <button
            type="button"
            onClick={() => setOther((v) => !v)}
            className="ui-fb-row-quiet-btn"
            aria-expanded={other}
          >
            {other ? "Hide the rest" : "Something else"}
          </button>
        )}
      </div>
      {other && (
        <div className="ui-fb-decision-row">
          <FeedbackItemRow
            feedback={f}
            projectName={f.projectName}
            project={project}
            busy={busy}
            {...rowProps}
          />
        </div>
      )}
    </article>
  );
}

function kindWord(rec: Recommendation): string {
  switch (rec.kind) {
    case RECOMMEND.CONFIRM:
      return "Confirm";
    case RECOMMEND.BUILD:
      return "Build";
    case RECOMMEND.RETRY:
      return "Try again";
    case RECOMMEND.CLOUD:
      return "Move to the cloud";
    case RECOMMEND.FILE:
      return "File away";
    case RECOMMEND.CONNECT:
      return "Connect";
  }
}

function excerpt(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  // The agent-filed "--- technical details ---" tail is not the report.
  const cut = one.split(/\s*---\s*technical details/i)[0];
  return cut.length > 140 ? `${cut.slice(0, 139)}…` : cut;
}
