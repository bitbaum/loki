"use client";

/**
 * "Waiting for your approval: <what>" for every permission prompt an agent
 * session is at, with how long it has waited and the answers it takes
 * (lib/approvals). Answered here, the keys go to the agent's terminal; the
 * answer is recorded on the run (who, how, when).
 *
 * Mounted on Home (which is the phone view) and on the Terminal page, scoped
 * to the open session there. Renders nothing while nothing waits.
 */
import { useState } from "react";
import { usePoll } from "@/hooks/use-poll";
import { postJson } from "@/lib/api/fetch";
import {
  APPROVAL_DECISION_LABEL,
  approvalHeadline,
  type ApprovalDecision,
  type PendingApproval,
} from "@/lib/approvals";

const POLL_MS = 10_000;

export function PendingApprovals({ tab = null }: { tab?: string | null }) {
  const scope = encodeURIComponent(tab ?? "*");
  const { data, refetch } = usePoll<{ approvals: PendingApproval[] }>(
    `/api/sessions/${scope}/pending-approvals`,
    POLL_MS,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const approvals = data?.approvals ?? [];
  if (approvals.length === 0 && !message) return null;

  async function answer(a: PendingApproval, decision: ApprovalDecision) {
    setBusy(a.id);
    setMessage(null);
    try {
      const res = await postJson(
        `/api/sessions/${encodeURIComponent(a.tab)}/approvals/${encodeURIComponent(a.id)}`,
        { decision },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(
        res.ok
          ? `${APPROVAL_DECISION_LABEL[decision]}: sent to ${a.tab}.`
          : (body.error ?? "That answer did not go through. Try again."),
      );
    } finally {
      setBusy(null);
      refetch();
    }
  }

  return (
    <section className="space-y-2" aria-label="Waiting for your approval" role="status">
      {approvals.map((a) => (
        <div key={a.id} className="ui-card space-y-2 p-3">
          <p className="text-sm font-medium">{approvalHeadline(a.question, a.since)}</p>
          <p className="text-xs text-muted-foreground">
            {a.tab === a.project ? a.project : `${a.project} · ${a.tab}`}
          </p>
          <div className="flex flex-wrap gap-2">
            {a.choices.map((decision) => (
              <button
                key={decision}
                type="button"
                className={
                  decision === "deny" ? "ui-btn-secondary ui-btn-sm" : "ui-btn-primary ui-btn-sm"
                }
                disabled={busy === a.id}
                onClick={() => void answer(a, decision)}
              >
                {APPROVAL_DECISION_LABEL[decision]}
              </button>
            ))}
          </div>
        </div>
      ))}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
