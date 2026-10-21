"use client";

import { useState } from "react";
import { CheckCircle, Loader2, Plus, X } from "lucide-react";
import type { Milestone } from "@/db/schema/goals";
import { patchGoal } from "@/lib/api/goals";
import { TOAST_MEDIUM_MS } from "@/lib/constants/timings";
import { DeleteButton } from "@/components/ui/delete-button";

export function AddMilestoneInline({
  goalId,
  milestones,
  onAdded,
}: {
  goalId: string;
  milestones: Milestone[];
  onAdded: (updated: Milestone[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const title = value.trim();
    if (!title || saving) return;
    setSaving(true);
    setError(null);
    const updated = [...milestones, { title, done: false }];
    try {
      await patchGoal(goalId, { milestones: updated });
      onAdded(updated);
      setValue("");
      setOpen(false);
    } catch {
      setError("Failed to add — try again");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ui-life-add">
        <Plus className="h-4 w-4" /> Add a milestone
      </button>
    );
  }

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setOpen(false);
              setValue("");
              setError(null);
            }
          }}
          placeholder="The next thing that has to be true"
          autoFocus
          aria-label="Milestone"
          className="ui-input flex-1"
        />
        <button
          onClick={save}
          disabled={!value.trim() || saving}
          className="ui-btn-confirm-icon shrink-0"
        >
          {saving ? <Loader2 className="ui-spinner-xs" /> : <Plus className="h-3 w-3" />}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setValue("");
            setError(null);
          }}
          className="ui-btn-inline-cancel"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {error && <p className="ui-error-xs mt-0.5">{error}</p>}
    </div>
  );
}

export function MilestoneRow({
  milestone,
  goalId,
  allMilestones,
  index,
  onUpdate,
}: {
  milestone: Milestone;
  goalId: string;
  allMilestones: Milestone[];
  index: number;
  onUpdate: (milestones: Milestone[], progress: number) => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(milestone.title);
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flashError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), TOAST_MEDIUM_MS);
  };

  const toggle = async () => {
    if (toggling) return;
    setToggling(true);
    setError(null);
    const updated = allMilestones.map((m, i) => (i === index ? { ...m, done: !m.done } : m));
    const doneCount = updated.filter((m) => m.done).length;
    const progress = updated.length > 0 ? Math.round((doneCount / updated.length) * 100) : 0;
    try {
      await patchGoal(goalId, { milestones: updated, progress });
      onUpdate(updated, progress);
    } catch {
      flashError("Failed to save — try again");
    } finally {
      setToggling(false);
    }
  };

  const saveRename = async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === milestone.title) {
      setEditing(false);
      setEditTitle(milestone.title);
      return;
    }
    setSavingEdit(true);
    setError(null);
    const updated = allMilestones.map((m, i) => (i === index ? { ...m, title: trimmed } : m));
    const doneCount = updated.filter((m) => m.done).length;
    const progress = updated.length > 0 ? Math.round((doneCount / updated.length) * 100) : 0;
    try {
      await patchGoal(goalId, { milestones: updated, progress });
      onUpdate(updated, progress);
      setEditing(false);
    } catch {
      flashError("Failed to save — try again");
    } finally {
      setSavingEdit(false);
    }
  };

  // DeleteButton surfaces its own error if patchGoal throws.
  const deleteMilestone = async () => {
    const updated = allMilestones.filter((_, i) => i !== index);
    const doneCount = updated.filter((m) => m.done).length;
    const progress = updated.length > 0 ? Math.round((doneCount / updated.length) * 100) : 0;
    await patchGoal(goalId, { milestones: updated, progress });
    onUpdate(updated, progress);
  };

  return (
    <div className="group">
      <div className="ui-milestone-row">
        <button
          onClick={toggle}
          disabled={toggling}
          className="shrink-0 h-11 w-11 flex items-center justify-center disabled:opacity-50 rounded"
        >
          {toggling ? (
            <Loader2 className="ui-spinner-sm text-text-muted" />
          ) : milestone.done ? (
            <CheckCircle className="h-5 w-5 text-status-positive" />
          ) : (
            <div className="h-5 w-5 rounded-full border-2 border-border-strong hover:border-border-interactive transition-colors" />
          )}
        </button>
        {editing ? (
          <div className="flex flex-1 items-center gap-1">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={saveRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") {
                  setEditing(false);
                  setEditTitle(milestone.title);
                }
              }}
              autoFocus
              className="ui-input flex-1"
            />
            {savingEdit && <Loader2 className="ui-spinner-xs shrink-0 text-text-muted" />}
          </div>
        ) : (
          <>
            <span
              onClick={() => setEditing(true)}
              className={`min-w-0 flex-1 cursor-text ${milestone.done ? "text-text-tertiary line-through" : "text-text-primary"}`}
              title="Click to rename"
            >
              {milestone.title}
            </span>
            <DeleteButton
              onDelete={deleteMilestone}
              label="Remove?"
              triggerTitle="Remove milestone"
              triggerClassName="ui-btn-icon shrink-0 text-text-muted hover:text-status-negative"
            />
          </>
        )}
      </div>
      {error && <p className="ui-error-xs ml-12">{error}</p>}
    </div>
  );
}
