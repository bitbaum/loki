"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Rocket } from "lucide-react";
import { postJson } from "@/lib/api/fetch";

/**
 * The strip an OWNER sees under their own report on /my-feedback.
 *
 * The page is written for a reporter, who has nothing to do after filing —
 * and "Filed and waiting for the maintainer" is the right sentence for them.
 * The owner who tested their own site from a phone read the same sentence
 * about their own project and was the maintainer it was waiting for
 * (2026-09-28). This is the way forward on the same screen: start the fix
 * here, or open the row where Watch and the provider switch live.
 */
export function OwnerFeedbackActions({
  feedbackId,
  projectId,
  canStart,
}: {
  feedbackId: string;
  projectId: string;
  canStart: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inboxHref = `/feedback?project=${encodeURIComponent(projectId)}`;

  const implement = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson(`/api/feedback/${feedbackId}/dispatch`, {});
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Loki could not start the fix.");
        return;
      }
      router.push(inboxHref);
    } catch {
      setError("Loki could not start the fix.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
      <span className="text-xs text-text-tertiary">Your project.</span>
      {canStart && (
        <button
          type="button"
          onClick={() => void implement()}
          disabled={busy}
          className="ui-btn-save gap-1.5"
          title="Ask the agent to fix this now — the same as Implement in your inbox"
        >
          {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
          Implement
        </button>
      )}
      <Link href={inboxHref} className="ui-btn-secondary">
        Open in Feedback
      </Link>
      {error && <span className="ui-error text-xs">{error}</span>}
    </div>
  );
}
