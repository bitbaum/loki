"use client";

// Sync-from-doc. Paste an updated concept/spec; AI diffs it against the current
// fields and proposes a PATCH — only the fields that changed, plus up to 3 new
// fields for facts that don't fit the schema. You review the diff and apply only
// what you approve, so a paste never silently clobbers a hand-edited field.

import { useState } from "react";
import { Loader2, RefreshCw, Check, X, Plus } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { DOC_PASTE_MAX } from "@/lib/constants";
import { CharCount } from "@/components/ui/char-count";

type Update = { key: string; current: string | null; proposed: string };
type NewAttr = { key: string; label: string; value: string };
type Preview = { updates: Update[]; newAttributes: NewAttr[]; unchangedCount: number };

const humanize = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function ProjectDocSync({
  projectId,
  onReload,
}: {
  projectId: string;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // New attributes the user has unticked (approved by default).
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  async function runPreview() {
    setBusy("preview");
    setError(null);
    setDoneMsg(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/reconcile`, { text });
      const json = (await res.json()) as Preview & { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      if (json.updates.length === 0 && json.newAttributes.length === 0) {
        setError("Nothing to change — the doc already matches the current fields.");
        return;
      }
      setPreview({
        updates: json.updates,
        newAttributes: json.newAttributes,
        unchangedCount: json.unchangedCount,
      });
      setRejected(new Set());
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy("apply");
    setError(null);
    try {
      const updates = Object.fromEntries(preview.updates.map((u) => [u.key, u.proposed]));
      const newAttributes = preview.newAttributes
        .filter((a) => !rejected.has(a.key))
        .map((a) => ({ key: a.key, value: a.value }));
      const res = await postJson(`/api/projects/${projectId}/reconcile`, {
        apply: { updates, newAttributes },
      });
      const json = (await res.json()) as { ok?: boolean; applied?: string[]; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setDoneMsg(
        `Applied ${json.applied?.length ?? 0} change${json.applied?.length === 1 ? "" : "s"}.`,
      );
      setPreview(null);
      setText("");
      setOpen(false);
      onReload();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  function toggleNew(key: string) {
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {!open && (
        <button
          onClick={() => {
            setOpen(true);
            setDoneMsg(null);
          }}
          className="ui-btn-chip ui-tap gap-1.5 px-3 text-xs"
          title="Paste an updated concept/spec — AI updates only the fields that changed and proposes new ones. You review before it applies."
        >
          <RefreshCw className="h-3.5 w-3.5 text-accent-text" />
          Sync from doc
        </button>
      )}

      {open && !preview && (
        <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-raised p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            rows={4}
            placeholder="Paste the updated concept or spec. AI diffs it against the current fields and shows you exactly what would change before anything is saved."
            className="ui-input w-full text-base leading-relaxed sm:text-xs"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <CharCount length={text.length} max={DOC_PASTE_MAX} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={runPreview}
              disabled={
                busy !== null || text.trim().length < 10 || text.trim().length > DOC_PASTE_MAX
              }
              className="ui-btn-save ui-tap gap-1.5"
            >
              {busy === "preview" ? (
                <Loader2 className="ui-spinner-xs" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Preview changes
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="ui-btn-text-cancel ui-tap"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded-lg border border-border-subtle bg-surface-raised p-3">
          {preview.updates.length > 0 && (
            <div className="space-y-2">
              <p className="ui-micro-label">
                {preview.updates.length} field{preview.updates.length === 1 ? "" : "s"} will change
              </p>
              {preview.updates.map((u) => (
                <div key={u.key} className="rounded-md border border-border-subtle p-2">
                  <p className="text-xs font-medium text-text-secondary">{humanize(u.key)}</p>
                  {u.current && (
                    <p className="text-micro text-text-muted line-through">{u.current}</p>
                  )}
                  <p className="text-xs text-text-primary">{u.proposed}</p>
                </div>
              ))}
            </div>
          )}

          {preview.newAttributes.length > 0 && (
            <div className="space-y-2">
              <p className="ui-micro-label">Proposed new fields — tick to add</p>
              {preview.newAttributes.map((a) => (
                <label
                  key={a.key}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border-subtle p-2"
                >
                  <input
                    type="checkbox"
                    checked={!rejected.has(a.key)}
                    onChange={() => toggleNew(a.key)}
                    className="mt-0.5 h-5 w-5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary">
                      <Plus className="h-3 w-3 text-accent-text" />
                      {a.label}
                    </span>
                    <span className="block text-xs text-text-primary">{a.value}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <p className="text-micro text-text-muted">
            {preview.unchangedCount} field{preview.unchangedCount === 1 ? "" : "s"} untouched.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={apply} disabled={busy !== null} className="ui-btn-save ui-tap gap-1.5">
              {busy === "apply" ? (
                <Loader2 className="ui-spinner-xs" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Apply changes
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={busy !== null}
              className="ui-btn-text-cancel inline-flex ui-tap items-center gap-1"
            >
              <X className="h-3.5 w-3.5" /> Discard
            </button>
          </div>
        </div>
      )}

      {doneMsg && <p className="text-xs text-status-positive">{doneMsg}</p>}
      {error && <p className="ui-error-xs">{error}</p>}
    </div>
  );
}
