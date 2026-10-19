"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/api/fetch";

/**
 * "Make it live" on a client's change that is written and waiting for them.
 * One tap; the page refreshes to say where the change is now. A refusal is
 * said in the server's words, in place — never a silent button.
 */
export function GoLiveButton({ feedbackId }: { feedbackId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    const response = await postJson(`/api/feedback/${feedbackId}/live`, {}).catch(() => null);
    if (response?.ok) {
      router.refresh();
      return;
    }
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? "That did not go through. Try again in a moment.");
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        className="ui-btn-primary min-h-11"
        disabled={busy}
        onClick={() => void go()}
      >
        {busy ? "Putting it live…" : "Make it live"}
      </button>
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}
