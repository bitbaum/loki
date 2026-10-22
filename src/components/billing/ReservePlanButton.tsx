"use client";

import { useState } from "react";
import type { Plan } from "@/db/schema/users";

/**
 * Reserve a paid plan, or take the reservation back. Charges nothing — the
 * page around it says so — and states the result in words, not a toast.
 */
export function ReservePlanButton({
  plan,
  planName,
  reservedPlan,
  reservedAt,
}: {
  plan: Plan;
  planName: string;
  reservedPlan: Plan | null;
  reservedAt: string | null;
}) {
  const [reserved, setReserved] = useState<{ plan: Plan; at: string } | null>(
    reservedPlan && reservedAt ? { plan: reservedPlan, at: reservedAt } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/reserve", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ plan }) } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        reservation?: { plan: Plan; updatedAt: string };
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Could not save that");
      setReserved(
        method === "POST" && body.reservation
          ? { plan: body.reservation.plan, at: body.reservation.updatedAt }
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  }

  const here = reserved?.plan === plan;
  return (
    <div className="flex flex-col gap-2">
      {here ? (
        <>
          <p className="text-sm font-medium text-text-primary">
            {planName} is reserved for you, since {new Date(reserved.at).toLocaleDateString()}.
            Nothing is charged; you hear from us the day checkout opens for your account.
          </p>
          <button
            type="button"
            className="ui-public-cta-ghost w-full text-center"
            onClick={() => send("DELETE")}
            disabled={busy}
          >
            Cancel the reservation
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ui-public-cta w-full text-center"
          onClick={() => send("POST")}
          disabled={busy}
        >
          {reserved ? `Switch my reservation to ${planName}` : `Reserve ${planName}`}
        </button>
      )}
      {error && <p className="ui-error text-sm">{error}</p>}
    </div>
  );
}
