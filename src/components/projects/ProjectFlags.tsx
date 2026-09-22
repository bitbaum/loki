"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { HEALTH_SIGNAL_CONFIG } from "./project-badges";
import { setAttr, removeAttr } from "@/lib/api/attrs";
import { timeAgo } from "@/lib/dates";
import type { AttrProvenance } from "@/lib/project-signals";
import { signalHasExpired } from "@/lib/project-signals";

/**
 * Raise, read and clear a project's flags — the half of the lifecycle that
 * did not exist.
 *
 * A flag (`security_vulnerability`, `broken_features`, `deployment_issue`) is
 * the strongest signal in the product: it sorts a project to the top of
 * /projects, colours its row, and costs it a health point. Before this, the
 * complete set of ways to RAISE one was: an agent writing the attr through the
 * API. There was no UI at all — and the one surface that lets you type an
 * arbitrary attr, "Additional context", explicitly excludes these three keys.
 *
 * So the operator saw a loud red badge on evig, had no idea what had put it
 * there, could not raise the same flag on another project that deserved it,
 * and could only clear it by finding a button inside a health disclosure.
 * George's read was "magic, or some other non-scalable, stupid solution" —
 * it was the second one: three free-text fields with no author and no door.
 *
 * NOTHING HERE DETECTS ANYTHING, and the copy says so. A flag is a note a
 * person or an agent wrote. Dressing that up as monitoring would be the same
 * lie in better clothes; the honest fix is to make authorship, age and the
 * clear path visible, so what the badge means is exactly what it says.
 */
export function ProjectFlags({
  projectId,
  attrs,
  attrMeta,
  readonly,
}: {
  projectId: string;
  attrs: Record<string, string>;
  attrMeta?: AttrProvenance;
  readonly?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function write(key: string, value: string) {
    setBusy(key);
    setError(null);
    try {
      await setAttr(`/api/projects/${projectId}`, key, value.trim());
      setEditing(null);
      setDraft("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the flag");
    } finally {
      setBusy(null);
    }
  }

  async function clear(key: string) {
    setBusy(key);
    setError(null);
    try {
      await removeAttr(`/api/projects/${projectId}`, key);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear the flag");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ui-project-section" aria-labelledby="project-flags-title">
      <h2 id="project-flags-title" className="text-lg font-semibold text-text-primary">
        Flags
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        A flag is a note someone wrote — an agent or you. Nothing here scans the project; a flag
        exists because it was written, and it stays until it is cleared. While one is set this
        project sorts to the top of Projects and loses a health point.
      </p>

      <div className="mt-4 divide-y divide-border-subtle border-y border-border-subtle">
        {HEALTH_SIGNAL_CONFIG.map((cfg) => {
          const raw = attrs[cfg.key];
          const expired = signalHasExpired(attrMeta, cfg.key);
          const set = Boolean(raw?.trim()) && !expired;
          const meta = attrMeta?.[cfg.key];
          const isEditing = editing === cfg.key;
          const isBusy = busy === cfg.key;

          return (
            <div key={cfg.key} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-text-primary">{cfg.label}</span>
                {set ? (
                  <span className="text-micro text-text-muted">
                    {meta?.updatedAt
                      ? `noted ${timeAgo(new Date(meta.updatedAt).getTime())}`
                      : null}
                    {meta?.source ? ` by ${meta.source}` : null}
                  </span>
                ) : (
                  <span className="text-micro text-text-muted">{expired ? "expired" : "none"}</span>
                )}
              </div>

              {set && !isEditing && (
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">{raw}</p>
              )}

              {isEditing ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    autoFocus
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`What is wrong? e.g. ${cfg.label.toLowerCase()} on the checkout page`}
                    className="ui-textarea w-full text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!draft.trim() || isBusy}
                      onClick={() => void write(cfg.key, draft)}
                      className="ui-btn-primary ui-btn-xs disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 className="ui-spinner-xs" /> : null}
                      {set ? "Save" : "Raise flag"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setDraft("");
                      }}
                      className="ui-btn-secondary ui-btn-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                !readonly && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setEditing(cfg.key);
                        setDraft(set ? raw : "");
                      }}
                      className="ui-btn-secondary ui-btn-xs"
                    >
                      {set ? "Edit" : <Plus className="h-3 w-3" aria-hidden />}
                      {set ? null : "Raise flag"}
                    </button>
                    {set && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void clear(cfg.key)}
                        className="ui-btn-secondary ui-btn-xs"
                      >
                        {isBusy ? (
                          <Loader2 className="ui-spinner-xs" />
                        ) : (
                          <X className="h-3 w-3" aria-hidden />
                        )}
                        Clear
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="ui-error-xs mt-2">{error}</p>}
    </section>
  );
}
