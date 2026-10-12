"use client";

// Client work and the client's consent to be shown, on the project itself.
//
// Work for a real person or organisation is theirs before it is ours to show.
// So a client project stays off every public surface (the fleet map, /fleet,
// the bitbaum portfolio, the public chat, /u/<owner>) until consent is recorded
// here, with how it was given. Withdrawing takes it off again on the next read.
// The rule itself is src/lib/register/client-work.ts; this only records answers.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";

type Props = {
  /** Entity id (UUID) — the PATCH endpoint keys on it. */
  projectId: string;
  /** The verdict: the operator's answer, else the hosting register's. */
  clientWork: boolean;
  /** When the client agreed, or null. */
  consentedAt: string | null;
  consentNote: string | null;
};

export function ProjectClientConsent({ projectId, clientWork, consentedAt, consentNote }: Props) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await patchJson(`/api/projects/${projectId}`, body);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  const spinner = saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;

  if (!clientWork) {
    return (
      <span className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => save({ clientWork: true })}
          disabled={saving}
          className="ui-btn-ghost min-h-11 gap-1.5"
          title="Built for a real person or organisation? Then it stays private until they agree."
        >
          {spinner}
          Mark as client work
        </button>
        {error && <span className="ui-error">{error}</span>}
      </span>
    );
  }

  if (consentedAt) {
    const day = new Date(consentedAt).toLocaleDateString("en-GB", { dateStyle: "medium" });
    return (
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-sm">
          <ShieldCheck className="h-4 w-4 text-accent-text" aria-hidden="true" />
          Agreed {day}
          {consentNote ? ` (${consentNote})` : ""}
        </span>
        <button
          type="button"
          onClick={() => save({ portfolioConsent: null })}
          disabled={saving}
          className="ui-btn-ghost min-h-11 gap-1.5"
          title="Takes it off every public surface on the next read."
        >
          {spinner}
          Withdraw consent
        </button>
        {error && <span className="ui-error">{error}</span>}
      </span>
    );
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) void save({ portfolioConsent: { note: note.trim() } });
      }}
    >
      <label className="ui-micro-label" htmlFor={`consent-${projectId}`}>
        How did they agree?
      </label>
      <input
        id={`consent-${projectId}`}
        className="ui-input-compact"
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Email from the client, 12 Oct"
      />
      <span className="flex flex-wrap items-center gap-1.5">
        <button
          type="submit"
          disabled={saving || !note.trim()}
          className="ui-btn-secondary min-h-11 gap-1.5"
        >
          {spinner}
          Record consent
        </button>
        <button
          type="button"
          onClick={() => save({ clientWork: false })}
          disabled={saving}
          className="ui-btn-ghost min-h-11"
          title="Our own work, not built for a client."
        >
          Not client work
        </button>
      </span>
      {error && <span className="ui-error">{error}</span>}
    </form>
  );
}
