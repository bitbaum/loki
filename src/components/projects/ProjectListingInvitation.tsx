"use client";

// "Can we show this one?" — asked once per project, and only when the project
// is real enough to be worth showing (src/lib/listing-invitation.ts decides).
//
// The whole point of the consent model is that a tenant's project reaches
// Loki's public catalogue because they agreed, not because they existed. But a
// toggle nobody finds collects one answer, and it is no — which leaves the
// catalogue empty and invites the old "just widen the query" fix. So Loki asks,
// plainly, and takes no for an answer permanently (per project, in the
// database, not in this browser).
//
// Both buttons are real decisions and neither is styled as the obvious one:
// this asks to publish someone's work, so "Not now" is not a dismissal to be
// hidden in a corner.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, X } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";

export function ProjectListingInvitation({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"list" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic removal: once answered, the question is gone for good, so the
  // card should not linger while the server round-trips.
  const [answered, setAnswered] = useState(false);

  if (answered) return null;

  async function answer(kind: "list" | "dismiss") {
    setBusy(kind);
    setError(null);
    try {
      const res = await patchJson(
        `/api/projects/${projectId}`,
        kind === "list" ? { listedPublicly: true } : { dismissListingPrompt: true },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setAnswered(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ui-listing-invite" aria-label="Public catalogue invitation">
      <div className="ui-listing-invite-body">
        <Globe className="ui-listing-invite-icon" aria-hidden="true" />
        <div className="min-w-0">
          <p className="ui-listing-invite-title">Show this project in Loki&rsquo;s catalogue?</p>
          <p className="ui-listing-invite-note">
            It would appear on the public fleet page, credited to you and linked to your profile.
            Nothing else is shared, and you can remove it at any time.
          </p>
          {error && <p className="ui-error mt-2">{error}</p>}
        </div>
      </div>
      <div className="ui-listing-invite-actions">
        <button
          type="button"
          onClick={() => answer("list")}
          disabled={busy !== null}
          className="ui-btn-secondary min-h-11 gap-1.5"
        >
          {busy === "list" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Yes, list it
        </button>
        <button
          type="button"
          onClick={() => answer("dismiss")}
          disabled={busy !== null}
          className="ui-btn-ghost min-h-11 gap-1.5"
        >
          {busy === "dismiss" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4" aria-hidden="true" />
          )}
          Not now
        </button>
      </div>
    </section>
  );
}
