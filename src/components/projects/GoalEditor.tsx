"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Target, Check, X, Loader2 } from "lucide-react";

/**
 * Goal-mode editor: set a project's Definition of Done (the bar the cross-model
 * DoD gate judges each run against) and an optional turn cap. Both persist as
 * project attributes that the gate reads on the next run close — see
 * src/lib/orchestration/dod-gate.ts. Read-only display until you click edit.
 */
export function GoalEditor({
  projectKey,
  definitionOfDone,
  maxTurns,
}: {
  projectKey: string;
  definitionOfDone: string | null;
  maxTurns: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [dod, setDod] = useState(definitionOfDone ?? "");
  const [turns, setTurns] = useState(maxTurns ? String(maxTurns) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/control/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectKey,
          definitionOfDone: dod.trim(),
          maxTurns: turns.trim() ? Number(turns) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <dt className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
          <Target className="h-3 w-3" /> Definition of done
          <button className="ui-btn-xs ml-auto ui-tap" onClick={() => setEditing(true)}>
            {definitionOfDone ? "Edit" : "Set"}
          </button>
        </dt>
        <dd className="text-sm leading-relaxed text-text-secondary">
          {definitionOfDone ? (
            <>
              {definitionOfDone}
              <span className="ml-1.5 text-xs text-text-muted">
                ·{" "}
                {maxTurns
                  ? `stop after ${maxTurns} turn${maxTurns === 1 ? "" : "s"}`
                  : "loop until met"}
              </span>
            </>
          ) : (
            <span className="text-text-muted">
              Not set — the fleet stops on the agent&apos;s own say-so.
            </span>
          )}
        </dd>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
        <Target className="h-3 w-3" /> Definition of done — one turn&apos;s bar, checkable from the
        handoff alone
      </dt>
      <textarea
        className="ui-input w-full"
        rows={2}
        value={dod}
        onChange={(e) => setDod(e.target.value)}
        placeholder="e.g. `npm run verify` passes, with its real output in the handoff; work committed and pushed"
        maxLength={300}
        aria-label="Definition of done"
      />
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-text-muted">Stop after</label>
        <input
          className="ui-input-compact w-16"
          type="number"
          min={0}
          max={20}
          value={turns}
          onChange={(e) => setTurns(e.target.value)}
          placeholder="∞"
          aria-label="Max turns"
        />
        <span className="text-xs text-text-muted">turns (blank = loop until met)</span>
      </div>
      {error && <p className="ui-error">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          className="ui-btn-primary ui-btn-xs inline-flex ui-tap items-center gap-1.5"
          onClick={save}
          disabled={saving}
        >
          {saving ? <Loader2 className="ui-spinner-sm" /> : <Check className="h-3.5 w-3.5" />} Save
        </button>
        <button
          className="ui-btn-ghost ui-btn-xs inline-flex ui-tap items-center gap-1.5"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}
