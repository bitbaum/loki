"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { PAUSE_MESSAGES } from "@/config/package-releases";

/**
 * "Pause vX.Y.Z everywhere" / "Resume vX.Y.Z" — the package owner's kill
 * switch. Pausing asks once (it reaches every project); resuming does not.
 * What happened comes back as one sentence beside the button.
 */
export function ReleasePauseButton({
  slug,
  version,
  paused,
}: {
  slug: string;
  version: string;
  paused: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);

  async function send(pause: boolean) {
    setBusy(true);
    setResult(null);
    try {
      const res = await postJson(`/api/packages/${slug}/pause`, { version, paused: pause });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not do that just now.");
      setResult({ text: body.message ?? "Done.", error: false });
      router.refresh();
    } catch (err) {
      setResult({
        text: err instanceof Error ? err.message : "Could not do that just now.",
        error: true,
      });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const spinner = busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />;
  return (
    <div className="min-w-0 space-y-2">
      {paused ? (
        <button
          type="button"
          onClick={() => void send(false)}
          disabled={busy}
          className="ui-btn-secondary min-h-11 gap-2"
        >
          {spinner || <Play className="h-4 w-4" aria-hidden />}
          Resume v{version}
        </button>
      ) : confirming ? (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">{PAUSE_MESSAGES.explain}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void send(true)}
              disabled={busy}
              className="ui-btn-danger min-h-11 gap-2"
            >
              {spinner}
              Yes, pause v{version}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="ui-btn-secondary min-h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="ui-btn-secondary min-h-11 gap-2"
        >
          <Pause className="h-4 w-4" aria-hidden />
          Pause v{version} everywhere
        </button>
      )}
      {result && (
        <p
          role={result.error ? "alert" : "status"}
          className={result.error ? "ui-error-xs" : "text-xs text-text-tertiary"}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
