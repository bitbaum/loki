"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PRICING_PLANS } from "@/config/plans";
import { postJson, throwApiError } from "@/lib/api/fetch";
import type { Plan } from "@/db/schema/users";

/**
 * Grant, extend or revoke a pass by hand — the operator's half of the
 * Bitcoin rail, for a payment made outside it, a trial, or a month given for
 * a bug found. Posts to /api/system/plan-grant and refreshes the list.
 */
export function PlanGrantForm({ users }: { users: { id: string; label: string; plan: Plan }[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [plan, setPlan] = useState<Plan>("pro");
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await postJson("/api/system/plan-grant", {
        userId,
        plan,
        days,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (!res.ok) await throwApiError(res, "Couldn't change the plan.");
      const data = (await res.json()) as { plan: Plan; expiresAt: string | null };
      setNote({
        ok: true,
        text:
          data.plan === "free"
            ? "Reverted to Free."
            : `${data.plan} until ${new Date(data.expiresAt!).toLocaleDateString()}.`,
      });
      setReason("");
      router.refresh();
    } catch (err) {
      setNote({
        ok: false,
        text: err instanceof Error ? err.message : "Couldn't change the plan.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (users.length === 0) return null;

  return (
    <form
      onSubmit={submit}
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
    >
      <label className="block text-xs text-text-secondary">
        Account
        <select
          className="ui-input ui-input-compact mt-1 w-full"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label} · {u.plan}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-text-secondary">
        Plan
        <select
          className="ui-input ui-input-compact mt-1 w-full"
          value={plan}
          onChange={(e) => setPlan(e.target.value as Plan)}
        >
          {PRICING_PLANS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key === "free" ? "Free (revoke)" : p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-text-secondary">
        Days
        <input
          type="number"
          min={1}
          max={3660}
          className="ui-input ui-input-compact mt-1 w-24"
          value={days}
          onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
          disabled={plan === "free"}
        />
      </label>
      <input
        className="ui-input ui-input-compact sm:col-span-2"
        placeholder="Why (optional, kept in the log)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
      />
      <button type="submit" className="ui-btn-primary text-sm" disabled={busy || !userId}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {plan === "free" ? "Revoke" : "Grant"}
      </button>
      {note && (
        <p
          className={`sm:col-span-3 text-xs ${note.ok ? "text-status-positive" : "text-status-negative"}`}
          role="status"
        >
          {note.text}
        </p>
      )}
    </form>
  );
}
