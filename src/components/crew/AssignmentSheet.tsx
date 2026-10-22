"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, Send, Trash2, Wallet, X } from "lucide-react";
import { DetailSheet, SheetAction, SheetActions } from "@/components/ui/detail-sheet";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/api/fetch";
import { deadlineLabel } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import {
  HUMAN_TASK_STATUS,
  HUMAN_TASK_STATUS_HINT,
  HUMAN_TASK_STATUS_LABEL,
  OPERATOR_MOVES,
  TASK_ACTOR,
  formatFee,
  formatSats,
  type HumanTaskStatus,
} from "@/config/crew";
import type { HumanTaskDetail, HumanTaskRow } from "@/db/queries/human-tasks";

/** Verbs, not status names: the row says what you are doing to the ask. */
const MOVE_LABEL: Record<HumanTaskStatus, string> = {
  [HUMAN_TASK_STATUS.DRAFT]: "Pull it back to a draft",
  [HUMAN_TASK_STATUS.ASSIGNED]: "Hand it over",
  [HUMAN_TASK_STATUS.ACCEPTED]: "Send it back for more",
  [HUMAN_TASK_STATUS.DECLINED]: "They declined",
  [HUMAN_TASK_STATUS.DELIVERED]: "Mark it delivered",
  [HUMAN_TASK_STATUS.DONE]: "Accept the work",
  [HUMAN_TASK_STATUS.CANCELLED]: "Call it off",
};

/**
 * One ask, opened from its row: where it stands, the brief and the reason,
 * the link you send them, paying them, and the moves open to you right now
 * (config/crew.ts → OPERATOR_MOVES), then its history. This was the body of
 * a card that unfolded inside the board.
 */
export function AssignmentSheet({
  task,
  crew,
  onClose,
  onChanged,
}: {
  task: HumanTaskRow;
  /** Who it can be given to, when nobody has it yet. */
  crew: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HumanTaskDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const current = detail ?? task;

  // The history carries the note they typed when they declined, which the
  // status alone has lost — fetched when the ask is opened, not with the board.
  useEffect(() => {
    let cancelled = false;
    getJson<{ task: HumanTaskDetail }>(`/api/crew/tasks/${task.id}`)
      .then((data) => {
        if (!cancelled) setDetail(data.task);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const fee = formatFee(current.feeAmount, current.feeCurrency);
  const sats = formatSats(current.feeAmount, current.feeCurrency);
  const owed = current.feeAmount !== null && current.feeAmount > 0;
  const shareUrl = current.sharePath
    ? `${typeof window === "undefined" ? "" : window.location.origin}${current.sharePath}`
    : null;

  async function run(action: () => Promise<Response>, closeAfter = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error ?? "That didn't work — try again.");
        return;
      }
      if (data.task) setDetail(data.task as HumanTaskDetail);
      onChanged();
      if (closeAfter) onClose();
    } catch {
      setError("Could not reach Loki — try again.");
    } finally {
      setBusy(false);
    }
  }

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const subtitle = [
    HUMAN_TASK_STATUS_LABEL[current.status],
    current.assigneeName ?? "Nobody asked yet",
    current.projectName ? projectTitle({ name: current.projectName }) : null,
    current.dueDate ? deadlineLabel(current.dueDate).label : null,
    fee ? `${fee}${sats ? ` (${sats})` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <DetailSheet title={current.title} subtitle={subtitle} onClose={onClose}>
      <p className="text-base text-text-secondary">{HUMAN_TASK_STATUS_HINT[current.status]}</p>

      {current.brief && (
        <div className="ui-life-field">
          <p className="ui-life-field-label">What to do</p>
          <p className="ui-life-prose">{current.brief}</p>
        </div>
      )}
      {current.reason && (
        <div className="ui-life-field">
          <p className="ui-life-field-label">Why it matters</p>
          <p className="ui-life-prose">{current.reason}</p>
        </div>
      )}

      {shareUrl ? (
        <div className="ui-life-field">
          <p className="ui-life-field-label">Their link — no account needed</p>
          <p className="truncate text-base text-text-primary">{shareUrl}</p>
        </div>
      ) : (
        !current.assigneeId &&
        (crew.length > 0 ? (
          <label className="ui-life-field block">
            <span className="ui-life-field-label">Who is doing it</span>
            <select
              value=""
              disabled={busy}
              onChange={(e) =>
                e.target.value &&
                run(() =>
                  patchJson(`/api/crew/tasks/${current.id}`, { assigneeId: e.target.value }),
                )
              }
              className="ui-input"
            >
              <option value="">Pick someone from your crew</option>
              {crew.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-base text-text-secondary">
            Nobody is on it yet. Add someone to your crew, then give it to them here.
          </p>
        ))
      )}

      {owed && !current.assigneePayUrl && (
        <p className="text-base text-text-secondary">
          {current.assigneeName ?? "They"} has no OrangeCat profile on file, so there is nowhere to
          send {fee}. Add it to their entry in your crew.
        </p>
      )}

      {error && <p className="ui-error-xs">{error}</p>}

      <SheetActions>
        {!current.sharePath && current.assigneeId && (
          <SheetAction
            icon={busy ? Loader2 : Send}
            disabled={busy}
            onClick={() => run(() => postJson(`/api/crew/tasks/${current.id}/share`, {}))}
          >
            Hand it over — make their link
          </SheetAction>
        )}
        {shareUrl && (
          <SheetAction icon={copied ? Check : Copy} onClick={copyLink}>
            {copied ? "Copied" : "Copy their link"}
          </SheetAction>
        )}
        {(OPERATOR_MOVES[current.status] ?? [])
          // "Hand over" is the link row above — one act, one row.
          .filter((next) => next !== HUMAN_TASK_STATUS.ASSIGNED)
          .map((next) => (
            <SheetAction
              key={next}
              icon={
                next === HUMAN_TASK_STATUS.DONE
                  ? Check
                  : next === HUMAN_TASK_STATUS.CANCELLED
                    ? X
                    : undefined
              }
              disabled={busy}
              onClick={() =>
                run(() => patchJson(`/api/crew/tasks/${current.id}`, { status: next }))
              }
            >
              {MOVE_LABEL[next]}
            </SheetAction>
          ))}
        {owed && current.assigneePayUrl && (
          <SheetAction icon={Wallet} href={current.assigneePayUrl}>
            Pay {current.assigneeName ?? "them"} {fee}
          </SheetAction>
        )}
        {current.feeAmount !== null && !current.orangecatServiceId && (
          <SheetAction
            icon={ExternalLink}
            disabled={busy}
            onClick={() => run(() => postJson(`/api/crew/tasks/${current.id}/publish`, {}))}
          >
            List it on OrangeCat
          </SheetAction>
        )}
        {current.orangecatUrl && (
          <SheetAction icon={ExternalLink} href={current.orangecatUrl}>
            See it on OrangeCat
          </SheetAction>
        )}
        {shareUrl && (
          <SheetAction
            icon={Link2}
            disabled={busy}
            onClick={() => run(() => deleteJson(`/api/crew/tasks/${current.id}/share`))}
          >
            Turn their link off
          </SheetAction>
        )}
        <SheetAction
          icon={Trash2}
          danger
          disabled={busy}
          onClick={() => run(() => deleteJson(`/api/crew/tasks/${current.id}`), true)}
        >
          Delete this ask
        </SheetAction>
      </SheetActions>

      {detail?.timeline && detail.timeline.length > 0 && (
        <div className="ui-life-field">
          <p className="ui-life-field-label">What happened</p>
          <ul className="space-y-2">
            {detail.timeline.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-base">
                <span className="min-w-0 flex-1 text-text-primary">
                  {entry.actor === TASK_ACTOR.ASSIGNEE ? (current.assigneeName ?? "They") : "You"}
                  {": "}
                  {entry.status ? HUMAN_TASK_STATUS_LABEL[entry.status].toLowerCase() : entry.kind}
                  {entry.note ? ` — ${entry.note}` : ""}
                </span>
                <span className="shrink-0 text-meta text-text-tertiary">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DetailSheet>
  );
}
