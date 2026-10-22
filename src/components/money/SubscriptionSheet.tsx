"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  CheckCheck,
  ExternalLink,
  Lightbulb,
  Loader2,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import {
  DetailSheet,
  SheetAction,
  SheetActions,
  SHEET_ACTION,
  SHEET_ACTION_DANGER,
} from "@/components/ui/detail-sheet";
import { DeleteButton } from "@/components/ui/delete-button";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { handleCancelSubscription } from "@/app/actions";
import { SUBSCRIPTION_META, FREQUENCY } from "@/config/subscriptions";
import { SUB_STATUS } from "@/lib/constants/statuses";
import { patchJson, postJson, deleteJson, throwApiError } from "@/lib/api/fetch";
import { advanceDueDate } from "@/lib/dates";
import { SubscriptionEditForm } from "./SubscriptionEditForm";
import type { SubscriptionView } from "./SubscriptionsList";

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/**
 * One subscription, opened from its row. Everything the row used to carry —
 * "Mark paid", a `…` menu of six entries, an inline edit form, the free
 * alternatives panel, a two-step cancel — lives here, as one list of actions.
 */
export function SubscriptionSheet({
  sub,
  subtitle,
  onClose,
}: {
  sub: SubscriptionView;
  subtitle: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState<"paid" | "cancel" | "reactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const meta = SUBSCRIPTION_META[sub.name];
  const isCancelled = sub.status === SUB_STATUS.CANCELLED;
  const isOneTime = sub.frequency === FREQUENCY.ONE_TIME;

  const run = async (kind: typeof busy, act: () => Promise<void>, failure: string) => {
    setBusy(kind);
    setError(null);
    try {
      await act();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : failure);
    } finally {
      setBusy(null);
    }
  };

  const markPaid = () =>
    run(
      "paid",
      async () => {
        const res = await patchJson(`/api/subscriptions/${sub.id}`, {
          nextDue: advanceDueDate(sub.nextDue, sub.frequency),
        });
        if (!res.ok) await throwApiError(res, "Could not mark it paid — try again");
        setNote("Paid. The next charge moved on by one period.");
      },
      "Could not mark it paid — try again",
    );

  const cancel = () =>
    run(
      "cancel",
      async () => {
        await handleCancelSubscription(sub.id);
        onClose();
      },
      "Could not mark it cancelled — try again",
    );

  const reactivate = () =>
    run(
      "reactivate",
      async () => {
        const res = await postJson(`/api/subscriptions/${sub.id}`, {});
        if (!res.ok) await throwApiError(res, "Could not reactivate — try again");
        onClose();
      },
      "Could not reactivate — try again",
    );

  const lokiPrompt = [
    `Subscription: ${sub.name}`,
    sub.vendor && `Vendor: ${sub.vendor}`,
    sub.amount != null &&
      `Cost: ${sub.amount} ${sub.currency ?? "CHF"} / ${sub.frequency ?? "month"}`,
    sub.nextDue && `Next due: ${sub.nextDue.slice(0, 10)}`,
    sub.notes && `Notes: ${sub.notes}`,
    "",
    "Is this subscription worth keeping? Are there cheaper alternatives, or ways to consolidate or cut costs?",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <DetailSheet title={sub.name} subtitle={subtitle} onClose={onClose}>
      {editing ? (
        <SubscriptionEditForm
          initial={sub}
          onCancel={() => setEditing(false)}
          onSave={async (data) => {
            const res = await patchJson(`/api/subscriptions/${sub.id}`, {
              name: data.name.trim() || undefined,
              vendor: data.vendor.trim() || null,
              amount: data.amount ? parseFloat(data.amount) : null,
              currency: data.currency,
              frequency: data.frequency,
              nextDue: data.nextDue || null,
              notes: data.notes || null,
              paymentMethod: data.paymentMethod || null,
            });
            if (!res.ok) await throwApiError(res, "Could not save — try again");
            setEditing(false);
            router.refresh();
          }}
        />
      ) : (
        <>
          {(sub.vendor || sub.paymentMethod) && (
            <p className="text-base text-text-secondary">
              {[sub.vendor, sub.paymentMethod].filter(Boolean).join(" · ")}
            </p>
          )}
          {sub.notes && <p className="ui-life-prose">{sub.notes}</p>}
          {sub.status === SUB_STATUS.UNVERIFIED && (
            <p className="text-base text-text-secondary">
              No billing email backs this one up yet, so the amount is your word, not a receipt.
            </p>
          )}

          {showAlternatives && meta && (
            <div className="space-y-1">
              <p className="ui-life-field-label">Free alternatives</p>
              <ul className="list-disc space-y-1 pl-5 text-base text-text-primary">
                {meta.alternatives.map((alt) => (
                  <li key={alt}>{alt}</li>
                ))}
              </ul>
            </div>
          )}

          {note && <p className="text-base text-text-secondary">{note}</p>}
          {error && <p className="ui-error-xs">{error}</p>}

          <SheetActions>
            {!isCancelled && !isOneTime && (
              <SheetAction
                icon={busy === "paid" ? Loader2 : CheckCheck}
                onClick={markPaid}
                disabled={busy !== null}
              >
                Mark this period paid
              </SheetAction>
            )}
            {!isCancelled && (
              <SheetAction icon={Pencil} onClick={() => setEditing(true)}>
                Edit amount, date or notes
              </SheetAction>
            )}
            {meta?.verifyUrl && (
              <SheetAction icon={BadgeCheck} href={meta.verifyUrl}>
                Check it at {hostOf(meta.verifyUrl)}
              </SheetAction>
            )}
            <LokiDispatchButton
              prompt={lokiPrompt}
              title="Ask Loki about this subscription"
              label="Ask Loki if it's worth keeping"
              className={SHEET_ACTION}
            />
            {meta && !meta.essential && meta.alternatives.length > 0 && (
              <SheetAction icon={Lightbulb} onClick={() => setShowAlternatives((v) => !v)}>
                {showAlternatives ? "Hide the free alternatives" : "Free alternatives"}
              </SheetAction>
            )}
            {meta && !isCancelled && (
              <SheetAction icon={ExternalLink} href={meta.cancelUrl}>
                Cancel it at {hostOf(meta.cancelUrl)}
              </SheetAction>
            )}
            {isCancelled ? (
              <SheetAction
                icon={busy === "reactivate" ? Loader2 : RotateCcw}
                onClick={reactivate}
                disabled={busy !== null}
              >
                I still pay for this — reactivate
              </SheetAction>
            ) : confirmCancel ? (
              <div className="flex min-h-12 items-center gap-3 px-2">
                <span className="flex-1 text-base text-text-primary">Mark it cancelled?</span>
                <button
                  type="button"
                  onClick={cancel}
                  disabled={busy !== null}
                  className="ui-btn-secondary"
                >
                  {busy === "cancel" ? <Loader2 className="ui-spinner-xs" /> : "Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="ui-btn-ghost"
                >
                  No
                </button>
              </div>
            ) : (
              <SheetAction icon={X} onClick={() => setConfirmCancel(true)} danger>
                I cancelled it
              </SheetAction>
            )}
            <DeleteButton
              onDelete={async () => {
                const res = await deleteJson(`/api/subscriptions/${sub.id}`);
                if (!res.ok) await throwApiError(res, "Could not delete — try again");
                onClose();
                router.refresh();
              }}
              label="Delete this record?"
              triggerTitle="Delete subscription record"
              triggerLabel="Delete the record"
              triggerClassName={SHEET_ACTION_DANGER}
            />
          </SheetActions>
        </>
      )}
    </DetailSheet>
  );
}
