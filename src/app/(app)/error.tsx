"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Report the digest + path to debug_logs so production crashes are
  // diagnosable without asking the user to share DevTools output. Fire
  // and forget — never block the error UI on a logging failure.
  useEffect(() => {
    if (typeof window === "undefined") return;
    fetch("/api/debug-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digest: error.digest,
        message: error.message,
        path: window.location.pathname,
        source: "app-error-boundary",
      }),
      keepalive: true,
    }).catch(() => {
      /* swallow */
    });
  }, [error]);

  // One sentence and the button that fixes it (design reset rule 9). The
  // error's own text is for the log above, not for the person: in production
  // it is the framework's digest notice, and before that it was whatever the
  // failing query threw.
  return (
    <div className="ui-empty-page">
      <EmptyState
        icon={AlertCircle}
        title="This page didn’t load."
        size="lg"
        action={
          <button type="button" onClick={reset} className="ui-btn-secondary min-h-11">
            Try again
          </button>
        }
      />
    </div>
  );
}
