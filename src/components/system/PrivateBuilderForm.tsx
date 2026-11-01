"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { postJson, throwApiError } from "@/lib/api/fetch";

/**
 * Give an account a private builder on Loki's cloud, or take it away. Posts
 * to /api/system/private-builder and refreshes the list; the box does the
 * rest within a minute (reconcile-tenants.sh).
 */
export function PrivateBuilderForm({
  users,
}: {
  users: { id: string; label: string; on: boolean }[];
}) {
  const router = useRouter();
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = users.find((u) => u.id === userId) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await postJson("/api/system/private-builder", {
        userId: chosen.id,
        enabled: !chosen.on,
      });
      if (!res.ok) await throwApiError(res, "Couldn't switch the runner.");
      setNote({
        ok: true,
        text: chosen.on
          ? `${chosen.label}'s runner stops within a minute; their home on the box is kept.`
          : `${chosen.label} gets their own runner within a minute. They sign in from Sessions: start claude, type /login.`,
      });
      router.refresh();
    } catch (err) {
      setNote({
        ok: false,
        text: err instanceof Error ? err.message : "Couldn't switch the runner.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (users.length === 0) return null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="ui-micro-label">Account</span>
        <select
          className="ui-input"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          aria-label="Account"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
              {u.on ? " · on the cloud" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className={chosen?.on ? "ui-btn-secondary min-h-11" : "ui-btn-primary min-h-11"}
        disabled={busy || !chosen}
      >
        {busy ? <Loader2 className="ui-spinner-sm" /> : null}
        {chosen?.on ? "Take the runner away" : "Give a private runner"}
      </button>
      {note && (
        <p className={note.ok ? "text-sm text-text-secondary" : "ui-error"} role="status">
          {note.text}
        </p>
      )}
    </form>
  );
}
