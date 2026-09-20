"use client";

// Consent to appear in Loki's own public catalogue at /fleet.
//
// /fleet is unauthenticated and speaks for the PRODUCT. Before this control the
// page read the projects table for one chosen account and listed every row it
// found, so a project was public because it existed — there was no decision to
// take and nowhere to take it. In a multi-tenant product that is backwards.
//
// The default is withheld consent (user_projects.listed_publicly, default
// false), which makes this button the ONLY way a project reaches that page.
// That is deliberate: the question has to be asked, and the answer has to be
// the owner's. Same shape as the "Publish to OrangeCat" opt-in beside it — a
// per-project decision, reversible from the same control that granted it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2 } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";

export function ProjectPublicListingToggle({
  projectId,
  listedPublicly,
}: {
  /** Entity id (UUID) — the PATCH endpoint keys on it. */
  projectId: string;
  /** Current stored consent. Null is treated as "not listed", never as "yes". */
  listedPublicly: boolean | null;
}) {
  const router = useRouter();
  const [listed, setListed] = useState(listedPublicly === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !listed;
    setSaving(true);
    setError(null);
    setListed(next);
    try {
      const res = await patchJson(`/api/projects/${projectId}`, { listedPublicly: next });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        setListed(!next); // the stored answer did not change, so neither may the shown one
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setListed(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      className="ui-btn-ghost min-h-11 gap-1.5"
      // Says what is true now and what a click will do — the button is both the
      // state and the decision, and a reader must not have to guess which.
      title={
        error
          ? `Could not save: ${error}`
          : listed
            ? "Listed in Loki's public catalogue at /fleet. Click to remove it."
            : "Not public. Click to list this project in Loki's public catalogue at /fleet."
      }
      aria-pressed={listed}
    >
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Globe className={listed ? "h-4 w-4 text-accent-text" : "h-4 w-4"} aria-hidden="true" />
      )}
      {listed ? "Listed publicly" : "List publicly"}
    </button>
  );
}
