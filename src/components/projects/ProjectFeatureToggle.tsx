"use client";

// The operator's editorial pick for Loki's landing hero.
//
// Deliberately a SEPARATE control from ProjectPublicListingToggle beside it,
// because the two answer to different people and that has to be visible:
//
//   "List publicly"  — the project OWNER's consent. May this be shown at all?
//   "Feature"        — the SITE OPERATOR's curation. Is it in the curated few?
//
// Folding them into one control would imply one decision, and would hide the
// rule that matters: featuring never overrides consent. The showcase query is
// consent AND featured (db/queries/public-visibility.ts), and the API refuses
// to feature a project whose owner has not listed it — so this only renders
// once consent exists, and says why when it does not.
//
// Only the site operator sees it at all; the API enforces the same thing, so
// hiding it is an affordance rather than the control.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Star } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";

export function ProjectFeatureToggle({
  projectId,
  featured,
  listedPublicly,
}: {
  /** Entity id (UUID). */
  projectId: string;
  /** Whether this project currently carries a featured_at stamp. */
  featured: boolean;
  /** The owner's consent. Without it there is nothing to feature. */
  listedPublicly: boolean;
}) {
  const router = useRouter();
  const [isFeatured, setIsFeatured] = useState(featured);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to curate until the owner has opted in. Saying so beats a control
  // that looks available and answers 404.
  if (!listedPublicly) {
    return (
      <span
        className="ui-btn-ghost min-h-11 gap-1.5 opacity-60"
        title="The owner has not listed this project publicly, so it cannot be featured. Consent comes first."
      >
        <Star className="h-4 w-4" aria-hidden="true" />
        Not listed
      </span>
    );
  }

  async function toggle() {
    const next = !isFeatured;
    setSaving(true);
    setError(null);
    setIsFeatured(next);
    try {
      const res = await patchJson(`/api/projects/${projectId}`, { featured: next });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        setIsFeatured(!next);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setIsFeatured(!next);
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
      title={
        error
          ? `Could not save: ${error}`
          : isFeatured
            ? "Featured on Loki's landing page. Click to remove it."
            : "Feature this project on Loki's landing page."
      }
      aria-pressed={isFeatured}
    >
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Star className={isFeatured ? "h-4 w-4 text-accent-text" : "h-4 w-4"} aria-hidden="true" />
      )}
      {isFeatured ? "Featured" : "Feature"}
    </button>
  );
}
