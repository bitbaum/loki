"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pause, Pencil, Play } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { Segmented } from "@/components/ui/segmented";
import { DeleteButton } from "@/components/ui/delete-button";
import {
  DetailSheet,
  SheetAction,
  SheetActions,
  SHEET_ACTION,
  SHEET_ACTION_DANGER,
} from "@/components/ui/detail-sheet";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { useInlineEdit } from "@/hooks/use-inline-edit";
import { patchJson, deleteJson } from "@/lib/api/fetch";
import { HABIT_FREQUENCY, type HabitFrequency, scheduledDays } from "@/lib/constants/statuses";
import { HABIT_HISTORY_DAYS } from "@/lib/constants";
import { TOAST_SHORT_MS } from "@/lib/constants/timings";
import { toLocalDateStr } from "@/lib/dates";
import type { HabitWithHistory } from "@/db/queries/habits";
import type { LinkedGoal } from "@/db/queries/habit-goals";
import { HabitHeatmap } from "./HabitHeatmap";
import { HabitGoalLinks } from "./HabitGoalLinks";

/** A habit as the page hands it over: its done days as a plain list. */
export type HabitRowData = Omit<HabitWithHistory, "completedDates"> & { completedDates: string[] };

/** How often, as a person says it. */
export const FREQUENCY_LABEL: Record<HabitFrequency, string> = {
  [HABIT_FREQUENCY.DAILY]: "Every day",
  [HABIT_FREQUENCY.WEEKDAYS]: "Weekdays",
  [HABIT_FREQUENCY.WEEKLY]: "Once a week",
};

const FREQUENCY_OPTIONS = (Object.values(HABIT_FREQUENCY) as HabitFrequency[]).map((f) => ({
  id: f,
  label: FREQUENCY_LABEL[f],
}));

/**
 * /habits — one row per habit: the circle on the left checks it off for today
 * (the thing you came to do), the row itself opens the habit — its month,
 * how often, the goals it feeds, pause and delete. The old card put all of
 * that, plus a 35-cell heatmap, on every habit at once.
 */
export function HabitsList({
  habits,
  linkedGoals,
  activeGoals,
}: {
  habits: HabitRowData[];
  linkedGoals: Record<string, LinkedGoal[]>;
  activeGoals: LinkedGoal[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = habits.filter((h) => h.active);
  const paused = habits.filter((h) => !h.active);

  const rows = (list: HabitRowData[]) => (
    <List aria-label="Habits">
      {list.map((h) => (
        <HabitRow
          key={h.id}
          habit={h}
          linkedGoals={linkedGoals[h.id] ?? []}
          activeGoals={activeGoals}
          open={openId === h.id}
          onOpen={() => setOpenId(h.id)}
          onClose={() => setOpenId(null)}
        />
      ))}
    </List>
  );

  return (
    <>
      {active.length > 0 && rows(active)}
      {paused.length > 0 && <Section title="Paused">{rows(paused)}</Section>}
    </>
  );
}

function HabitRow({
  habit,
  linkedGoals,
  activeGoals,
  open,
  onOpen,
  onClose,
}: {
  habit: HabitRowData;
  linkedGoals: LinkedGoal[];
  activeGoals: LinkedGoal[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const today = toLocalDateStr(new Date());
  const [doneToday, setDoneToday] = useState(() => habit.completedDates.includes(today));
  const [toggling, setToggling] = useState(false);
  const [active, setActive] = useState(habit.active);
  const [frequency, setFrequency] = useState<HabitFrequency>(habit.frequency);
  const [title, setTitle] = useState(habit.title);
  const [busy, setBusy] = useState<"freq" | "active" | null>(null);
  const [error, setError] = useState("");
  const titleEdit = useInlineEdit<string>(habit.title);

  const scheduled = scheduledDays(frequency, HABIT_HISTORY_DAYS);
  const pct = Math.min(100, Math.round((habit.completionsInWindow / scheduled) * 100));
  // The heatmap reads today's tap too, without waiting for a refresh.
  const completed = [
    ...habit.completedDates.filter((d) => d !== today),
    ...(doneToday ? [today] : []),
  ];

  const flash = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(""), TOAST_SHORT_MS);
  };

  const patch = async (body: Record<string, unknown>) => {
    const res = await patchJson(`/api/habits/${habit.id}`, body);
    if (!res.ok) throw new Error("Failed");
  };

  const toggleDone = async () => {
    if (toggling || !active) return;
    setToggling(true);
    const next = !doneToday;
    setDoneToday(next);
    try {
      await patch({ done: next });
    } catch {
      setDoneToday(!next);
      flash("Could not save — try again");
    } finally {
      setToggling(false);
    }
  };

  const changeFrequency = async (next: HabitFrequency) => {
    const prev = frequency;
    setFrequency(next);
    setBusy("freq");
    try {
      await patch({ frequency: next });
    } catch {
      setFrequency(prev);
      flash("Could not save — try again");
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async () => {
    const next = !active;
    setActive(next);
    setBusy("active");
    try {
      await patch({ active: next });
      router.refresh();
    } catch {
      setActive(!next);
      flash("Could not save — try again");
    } finally {
      setBusy(null);
    }
  };

  const commitTitle = () => {
    const trimmed = titleEdit.draft.trim();
    if (!trimmed || trimmed === title) {
      titleEdit.cancel();
      return;
    }
    titleEdit
      .commit(async () => {
        await patch({ title: trimmed });
        setTitle(trimmed);
      })
      .then((saved) => {
        if (!saved) flash("Could not rename — try again");
      });
  };

  const streak = habit.streak >= 2 ? `${habit.streak}-day streak` : null;
  const secondary = [
    // "Done today" is the check on the left; the line does not say it twice.
    !active ? "Paused" : null,
    FREQUENCY_LABEL[frequency],
    streak,
  ]
    .filter(Boolean)
    .join(" · ");

  const lokiPrompt = [
    `Habit: ${title}`,
    `How often: ${FREQUENCY_LABEL[frequency]}`,
    `Kept ${pct}% of the time (${habit.completionsInWindow} of ${scheduled} days in the last ${HABIT_HISTORY_DAYS} days)`,
    streak && `Current streak: ${habit.streak} days`,
    doneToday ? "Done today" : "Not done yet today",
    linkedGoals.length > 0 && `Linked goals: ${linkedGoals.map((g) => g.title).join(", ")}`,
    "",
    "How can I keep this habit more consistently? What would help me stick to it?",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <ListRow
        onClick={onOpen}
        control={
          <button
            type="button"
            onClick={toggleDone}
            disabled={toggling || !active}
            aria-pressed={doneToday}
            aria-label={doneToday ? `${title}: done today. Undo` : `Mark ${title} done today`}
            className="ui-habit-check"
          >
            {toggling ? (
              <Loader2 className="ui-spinner-sm" />
            ) : doneToday ? (
              <span className="ui-habit-check-done">
                <Check className="h-4 w-4" />
              </span>
            ) : (
              <span className="ui-habit-check-ring" />
            )}
          </button>
        }
        title={title}
        secondary={error || secondary}
        trailing={`${pct}%`}
        chevron
      />
      {open && (
        <DetailSheet
          title={title}
          subtitle={`Kept ${pct}% of the time over the last ${HABIT_HISTORY_DAYS} days${streak ? ` · ${streak}` : ""}`}
          onClose={onClose}
        >
          {titleEdit.editing && (
            <input
              value={titleEdit.draft}
              onChange={(e) => titleEdit.setDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") titleEdit.cancel();
              }}
              autoFocus
              aria-label="Habit name"
              className="ui-input"
            />
          )}
          <HabitHeatmap completedDates={completed} frequency={frequency} />

          <div className="space-y-2">
            <p className="ui-life-field-label">How often</p>
            <Segmented
              label="How often"
              options={FREQUENCY_OPTIONS}
              value={frequency}
              pending={busy === "freq" ? frequency : null}
              onChange={(id) => changeFrequency(id as HabitFrequency)}
            />
          </div>

          <div className="space-y-1">
            <p className="ui-life-field-label">Goals it feeds</p>
            <HabitGoalLinks habitId={habit.id} linked={linkedGoals} allGoals={activeGoals} />
          </div>

          {error && <p className="ui-error-xs">{error}</p>}

          <SheetActions>
            <SheetAction
              icon={busy === "active" ? Loader2 : active ? Pause : Play}
              onClick={toggleActive}
              disabled={busy === "active"}
            >
              {active ? "Pause this habit" : "Start it again"}
            </SheetAction>
            <SheetAction icon={Pencil} onClick={() => titleEdit.start(title)}>
              Rename
            </SheetAction>
            <LokiDispatchButton
              prompt={lokiPrompt}
              title="Ask Loki about this habit"
              label="Ask Loki how to keep it"
              className={SHEET_ACTION}
            />
            <DeleteButton
              onDelete={async () => {
                const res = await deleteJson(`/api/habits/${habit.id}`);
                if (!res.ok) throw new Error("Could not delete — try again");
                onClose();
                router.refresh();
              }}
              label="Delete this habit and its history?"
              triggerTitle="Delete habit"
              triggerLabel="Delete habit"
              triggerClassName={SHEET_ACTION_DANGER}
            />
          </SheetActions>
        </DetailSheet>
      )}
    </>
  );
}
