"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { deadlineLabel } from "@/lib/dates";
import {
  ASSIGNEE_ACTION,
  ASSIGNEE_ACTION_LABEL,
  HUMAN_TASK_STATUS,
  HUMAN_TASK_STATUS_LABEL,
  HUMAN_TASK_STATUS_TONE,
  TASK_ACTOR,
  formatFee,
  formatSats,
  type AssigneeAction,
} from "@/config/crew";
import type { SharedTask } from "@/db/queries/human-tasks";

/**
 * What the person who was asked sees.
 *
 * They have no account and never will, so this page has to carry the whole
 * conversation: who is asking, what the work is, WHY it matters, what it pays,
 * and three honest answers — yes, no, or done. Declining is a first-class
 * button, not a link in small print: an ask you cannot refuse is an order, and
 * Loki is not in the business of issuing those to people.
 */
export function SharedTaskView({ token, initialTask }: { token: string; initialTask: SharedTask }) {
  const [task, setTask] = useState(initialTask);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<AssigneeAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const due = task.dueDate ? deadlineLabel(task.dueDate) : null;
  const fee = formatFee(task.feeAmount, task.feeCurrency);
  const sats = formatSats(task.feeAmount, task.feeCurrency);

  async function respond(action: AssigneeAction) {
    setBusy(action);
    setError(null);
    try {
      const res = await postJson(`/api/share/task/${token}`, {
        action,
        note: note.trim() || undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error ?? "That didn't go through — try again.");
        return;
      }
      setTask(data.task as SharedTask);
      setNote("");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="ui-public-eyebrow">{task.fromName} is asking</p>
        <h1 className="text-2xl font-semibold leading-tight text-text-primary sm:text-3xl">
          {task.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-tertiary">
          <span className={`ui-tag ui-tag-${HUMAN_TASK_STATUS_TONE[task.status]}`}>
            {HUMAN_TASK_STATUS_LABEL[task.status]}
          </span>
          {task.projectName && <span>{task.projectName}</span>}
          {due && <span className={due.overdue ? "text-status-negative" : ""}>{due.label}</span>}
          {fee && (
            <span>
              {fee}
              {sats ? ` · ${sats}` : ""}
            </span>
          )}
        </div>
      </header>

      {task.brief && (
        <section className="space-y-2">
          <h2 className="ui-kicker">What to do</h2>
          <p className="ui-crew-task-prose">{task.brief}</p>
        </section>
      )}

      {task.reason && (
        <section className="space-y-2">
          <h2 className="ui-kicker">Why it matters</h2>
          <p className="ui-crew-task-prose">{task.reason}</p>
        </section>
      )}

      {fee && (
        <section className="space-y-2">
          <h2 className="ui-kicker">What it pays</h2>
          {task.payToUrl ? (
            <p className="text-sm text-text-secondary">
              {fee}
              {sats ? ` (${sats})` : ""}, sent to your OrangeCat profile —{" "}
              <a href={task.payToUrl} target="_blank" rel="noreferrer" className="ui-link">
                {task.payToUrl.replace(/^https?:\/\//, "")}
              </a>
              . {task.fromName} pays it there once the work is accepted.
            </p>
          ) : (
            // Said plainly rather than hidden: agreeing to paid work with no
            // destination on file is the thing worth knowing BEFORE you say yes.
            <p className="text-sm text-status-warning">
              {fee}
              {sats ? ` (${sats})` : ""} — but {task.fromName} has no OrangeCat profile on file for
              you, so there is nowhere to send it yet. Send them your profile link before you start.
            </p>
          )}
          {task.orangecatUrl && (
            <a
              href={task.orangecatUrl}
              target="_blank"
              rel="noreferrer"
              className="ui-btn-secondary w-fit"
            >
              <ExternalLink className="h-4 w-4" />
              This work on OrangeCat
            </a>
          )}
        </section>
      )}

      {task.actions.length > 0 ? (
        <section className="space-y-3">
          <label className="ui-kicker block" htmlFor="crew-response-note">
            Anything to say back? (optional)
          </label>
          <textarea
            id="crew-response-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="e.g. I can do this, but not before Thursday."
            className="ui-input"
          />
          <div className="flex flex-wrap gap-2">
            {task.actions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={busy !== null}
                onClick={() => respond(action)}
                className={
                  action === ASSIGNEE_ACTION.DECLINE ? "ui-public-cta-ghost" : "ui-public-cta"
                }
              >
                {busy === action ? "Sending…" : ASSIGNEE_ACTION_LABEL[action]}
              </button>
            ))}
          </div>
          {error && <p className="ui-error">{error}</p>}
        </section>
      ) : (
        <p className="text-sm text-text-tertiary">
          {task.status === HUMAN_TASK_STATUS.DELIVERED
            ? `Thanks — ${task.fromName} has it and will take it from here.`
            : `Nothing to answer right now. ${task.fromName} has this one.`}
        </p>
      )}

      {task.timeline.length > 0 && (
        <section className="ui-crew-timeline">
          <h2 className="ui-kicker">History</h2>
          {task.timeline.map((entry) => (
            <div key={entry.id} className="ui-crew-timeline-row">
              <span className="ui-micro-label">
                {entry.actor === TASK_ACTOR.ASSIGNEE ? "You" : task.fromName}
              </span>
              <span>
                {entry.status ? HUMAN_TASK_STATUS_LABEL[entry.status] : "Sent to you"}
                {entry.note ? ` — ${entry.note}` : ""}
              </span>
              <span className="ml-auto tabular-nums">
                {new Date(entry.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
