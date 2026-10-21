"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Target, Plus, XCircle, Loader2, X } from "lucide-react";
import { postJson, deleteJson } from "@/lib/api/fetch";
import type { LinkedGoal } from "@/db/queries/habit-goals";
import { TOAST_SHORT_MS } from "@/lib/constants/timings";

export function HabitGoalLinks({
  habitId,
  linked,
  allGoals,
}: {
  habitId: string;
  linked: LinkedGoal[];
  allGoals: LinkedGoal[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<LinkedGoal[]>(linked);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const flashError = (msg: string) => {
    setLinkError(msg);
    setTimeout(() => setLinkError(null), TOAST_SHORT_MS);
  };

  const unlinked = allGoals.filter((g) => !items.some((l) => l.id === g.id));

  const handleLink = async (goal: LinkedGoal) => {
    setSaving(goal.id);
    setPicking(false);
    try {
      const res = await postJson(`/api/habits/${habitId}/goals`, { goalId: goal.id });
      if (res.ok) {
        setItems((prev) => [...prev, goal]);
        router.refresh();
      } else {
        setPicking(true);
        flashError("Failed to link — try again");
      }
    } catch {
      setPicking(true);
      flashError("Network error — try again");
    } finally {
      setSaving(null);
    }
  };

  const handleUnlink = async (goalId: string) => {
    setSaving(goalId);
    try {
      const res = await deleteJson(`/api/habits/${habitId}/goals`, { goalId });
      if (res.ok) {
        setItems((prev) => prev.filter((g) => g.id !== goalId));
        router.refresh();
      } else {
        flashError("Failed to unlink — try again");
      }
    } catch {
      flashError("Network error — try again");
    } finally {
      setSaving(null);
    }
  };
  // Rows, in the habit's sheet: each linked goal with its own unlink, then
  // "Link a goal" opening the goals not linked yet as rows to tap.
  return (
    <div className="space-y-1">
      {items.length === 0 && !picking && (
        <p className="text-base text-text-tertiary">Not linked to a goal yet.</p>
      )}
      {items.map((goal) => (
        <div key={goal.id} className="ui-milestone-row">
          <Target className="mx-3 h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-text-primary">{goal.title}</span>
          <button
            type="button"
            onClick={() => handleUnlink(goal.id)}
            disabled={saving === goal.id}
            className="ui-btn-icon shrink-0 text-text-muted"
            aria-label={`Unlink ${goal.title}`}
            title="Unlink"
          >
            {saving === goal.id ? (
              <Loader2 className="ui-spinner-sm" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
          </button>
        </div>
      ))}
      {linkError && <p className="ui-error-xs">{linkError}</p>}
      {picking ? (
        <div className="space-y-1 border-t border-border-subtle pt-2">
          {unlinked.map((goal) => (
            <button
              key={goal.id}
              type="button"
              onClick={() => handleLink(goal)}
              disabled={saving !== null}
              className="ui-detail-sheet-action"
            >
              <Plus className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{goal.title}</span>
            </button>
          ))}
          <button type="button" onClick={() => setPicking(false)} className="ui-life-add">
            <X className="h-4 w-4" /> Done
          </button>
        </div>
      ) : (
        unlinked.length > 0 && (
          <button type="button" onClick={() => setPicking(true)} className="ui-life-add">
            <Plus className="h-4 w-4" /> Link a goal
          </button>
        )
      )}
    </div>
  );
}
