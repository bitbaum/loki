"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ListChecks, Loader2, Lock, X } from "lucide-react";
import { getJson, postJson } from "@/lib/api/fetch";
import { queuedActionView, type QueuedActionResult } from "@/lib/loki/queued-action-view";
import type { ActionStatus } from "@/lib/constants/statuses";

const TONE_CLASS = {
  pending: "ui-loki-queued-card",
  positive: "ui-loki-queued-card ui-loki-queued-card-positive",
  neutral: "ui-loki-queued-card",
  warning: "ui-loki-queued-card ui-loki-queued-card-warning",
} as const;

type Decision = "approve" | "reject";

/**
 * The action an answer queued, decided where it was proposed.
 *
 * Reads the action's real status on mount, so a draft approved on another
 * device, or one that expired, never shows buttons a reload would take back.
 * "Do it" and "Not now" go to the same decision path as the approvals page
 * (draft → approved → executed, finalizeApproved); nothing here can run an
 * action the operator did not explicitly approve.
 *
 * Deciding is behind the private-zone PIN when one is set. A locked zone is
 * not a dead end: the PIN field opens in place, and the decision that was
 * tapped goes through the moment it is accepted.
 */
export function QueuedActionCard({ meta }: { meta: Record<string, unknown> | null }) {
  const id = typeof meta?.queuedActionId === "string" ? meta.queuedActionId : null;
  const title = typeof meta?.queuedActionTitle === "string" ? meta.queuedActionTitle : "an action";
  const autoApproved = meta?.queuedActionAutoApproved === true;

  const [status, setStatus] = useState<ActionStatus | null>(null);
  const [result, setResult] = useState<QueuedActionResult | null>(null);
  const [declined, setDeclined] = useState(false);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<Decision | null>(null);
  const [pin, setPin] = useState("");
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id || autoApproved) return;
    let current = true;
    getJson<{ status?: ActionStatus }>(`/api/actions/${id}/status`)
      .then((d) => {
        if (current && d.status) setStatus(d.status);
      })
      .catch(() => {
        /* unknown status: the decision is still offered, the server judges */
      });
    return () => {
      current = false;
    };
  }, [id, autoApproved]);

  useEffect(() => {
    if (pinFor) pinRef.current?.focus();
  }, [pinFor]);

  if (!id) return null;

  async function decide(decision: Decision) {
    if (!id) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await postJson(`/api/actions/${id}/decision`, { decision });
      const body = (await res.json().catch(() => ({}))) as {
        status?: ActionStatus;
        result?: QueuedActionResult;
        code?: string;
        error?: string;
      };
      if (res.status === 403 && body.code === "private_zone_locked") {
        setPinFor(decision);
        return;
      }
      if (res.status === 404) {
        // Already decided somewhere else: show what actually happened.
        const now = await getJson<{ status?: ActionStatus }>(`/api/actions/${id}/status`).catch(
          () => null,
        );
        if (now?.status) setStatus(now.status);
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "That did not go through. Try again.");
        return;
      }
      if (body.status) setStatus(body.status);
      if (decision === "reject") setDeclined(true);
      else setResult(body.result ?? { executed: false, deferred: true });
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function unlockAndDecide(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || !pinFor) return;
    const decision = pinFor;
    setBusy(decision);
    setError(null);
    try {
      const res = await postJson("/api/auth/pin", { pin });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Incorrect PIN");
        setPin("");
        setBusy(null);
        pinRef.current?.focus();
        return;
      }
      setPinFor(null);
      setPin("");
    } catch {
      setError("Network error — try again.");
      setBusy(null);
      return;
    }
    await decide(decision);
  }

  const view = queuedActionView({ title, autoApproved, status, result, declined });

  return (
    <div className={TONE_CLASS[view.tone]} role="group" aria-label="Queued action">
      <p className="ui-loki-queued-line">
        <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">{view.line}</span>
      </p>

      {view.canDecide && !pinFor && (
        <div className="ui-loki-queued-actions">
          <button
            type="button"
            className="ui-btn-primary ui-btn-xs gap-1.5"
            onClick={() => void decide("approve")}
            disabled={busy !== null}
          >
            {busy === "approve" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
            Do it
          </button>
          <button
            type="button"
            className="ui-btn-ghost ui-btn-xs gap-1.5"
            onClick={() => void decide("reject")}
            disabled={busy !== null}
          >
            {busy === "reject" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <X className="h-3.5 w-3.5" aria-hidden />
            )}
            Not now
          </button>
          {view.reviewLabel && (
            <Link href="/approvals" className="ui-loki-queued-review">
              {view.reviewLabel}
            </Link>
          )}
        </div>
      )}

      {pinFor && (
        <form className="ui-loki-queued-actions" onSubmit={(e) => void unlockAndDecide(e)}>
          <Lock className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
          <input
            ref={pinRef}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Your PIN"
            aria-label="Private zone PIN"
            className="ui-input-compact w-28"
          />
          <button
            type="submit"
            className="ui-btn-primary ui-btn-xs gap-1.5"
            disabled={!pin || busy !== null}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {pinFor === "approve" ? "Unlock and do it" : "Unlock and decline"}
          </button>
          <button
            type="button"
            className="ui-btn-ghost ui-btn-xs"
            onClick={() => {
              setPinFor(null);
              setPin("");
              setError(null);
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {!view.canDecide && view.reviewLabel && (
        <Link href="/approvals" className="ui-loki-queued-review">
          {view.reviewLabel}
        </Link>
      )}

      {error && <p className="ui-error-xs">{error}</p>}
    </div>
  );
}
