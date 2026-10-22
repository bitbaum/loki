"use client";

import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  CheckCircle,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  Repeat2,
  RotateCcw,
} from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { Section } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";
import { EmptyState } from "@/components/ui/empty-state";
import {
  SheetAction,
  SheetActions,
  SHEET_ACTION,
  SHEET_ACTION_DANGER,
} from "@/components/ui/detail-sheet";
import { DeleteButton } from "@/components/ui/delete-button";
import { GoalProgressBar } from "@/components/shared/GoalProgressBar";
import { useGoalCard } from "@/hooks/use-goal-card";
import { deleteGoal } from "@/lib/api/goals";
import { deadlineLabel } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import type { GoalWithChildren } from "@/db/queries/goals";
import type { LinkedHabit } from "@/db/queries/habit-goals";
import {
  ProgressInput,
  DateInput,
  SendToLokiButton,
  CopyGoalPromptButton,
} from "./goal-card-helpers";
import { AddMilestoneInline, MilestoneRow } from "./goal-milestone-helpers";
import { GoalRows } from "./GoalsList";

/**
 * A goal's own page (/goals/[id]). Everything the old card crammed into one
 * box — the inline title, a description button, a percentage, a date, four
 * menu actions, folded milestones and nested sub-goal cards — laid out as a
 * page: one line on where it stands, its fields as rows, its milestones and
 * sub-goals as lists, and what you can do with it as rows at the end.
 */
export function GoalDetail({
  goal,
  parent,
  habits,
}: {
  goal: GoalWithChildren;
  parent: { id: string; title: string } | null;
  habits: LinkedHabit[];
}) {
  const router = useRouter();
  const g = useGoalCard(goal);

  const due = g.targetDate ? deadlineLabel(g.targetDate) : null;
  const milestonesDone = g.milestones.filter((m) => m.done).length;
  const statusLine = g.isCompleted
    ? "Finished"
    : g.isAbandoned
      ? "Set aside"
      : [`${g.progress}% done`, due?.label].filter(Boolean).join(" · ");
  const back = parent
    ? { href: `/goals/${parent.id}`, label: parent.title }
    : { href: "/goals", label: "Goals" };

  const promptProps = {
    title: g.displayTitle,
    description: g.description ?? null,
    progress: g.progress,
    milestones: g.milestones,
    targetDate: g.targetDate,
    entityName: goal.entityName,
  };

  return (
    <PageLayout title={g.displayTitle} back={back} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {g.titleEdit.editing && (
          <input
            value={g.titleEdit.draft}
            onChange={(e) => g.titleEdit.setDraft(e.target.value)}
            onBlur={g.commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") g.commitTitle();
              if (e.key === "Escape") g.titleEdit.cancel();
            }}
            autoFocus
            aria-label="Goal title"
            className="ui-input"
          />
        )}
        {g.titleError && <p className="ui-error-xs">{g.titleError}</p>}
        <p className="ui-life-summary">{statusLine}</p>
        {!g.isClosed && (
          <GoalProgressBar value={g.progress} minPercent={1} className="h-1.5 bg-surface-raised" />
        )}
        {g.statusError && <p className="ui-error-xs">{g.statusError}</p>}
      </div>

      <Section title="About">
        {g.descEdit.editing ? (
          <div className="space-y-2">
            <textarea
              value={g.descEdit.draft}
              onChange={(e) => g.descEdit.setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") g.descEdit.cancel();
                if (e.key === "Enter" && e.metaKey) g.commitDesc();
              }}
              autoFocus
              rows={3}
              placeholder="What this goal is for"
              className="ui-input resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={g.commitDesc}
                disabled={g.descEdit.saving}
                className="ui-btn-secondary"
              >
                {g.descEdit.saving ? <Loader2 className="ui-spinner-xs" /> : "Save"}
              </button>
              <button type="button" onClick={g.descEdit.cancel} className="ui-btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => !g.isClosed && g.descEdit.start(g.description ?? "")}
            disabled={g.isClosed}
            className="ui-life-editable"
          >
            {g.description ? (
              <span className="ui-life-prose">{g.description}</span>
            ) : (
              <span className="ui-life-prose-empty">
                {g.isClosed ? "No description" : "Add a description"}
              </span>
            )}
          </button>
        )}
        {g.descError && <p className="ui-error-xs">{g.descError}</p>}

        <dl className="ui-life-fieldrows">
          <div className="ui-life-fieldrow">
            <dt>Progress</dt>
            <dd>
              {g.milestones.length > 0 || g.isClosed ? (
                <span>
                  {g.progress}%
                  {g.milestones.length > 0 && !g.isClosed && (
                    <span className="text-text-tertiary"> from milestones</span>
                  )}
                </span>
              ) : (
                <ProgressInput goalId={goal.id} initial={g.progress} onUpdate={g.setProgress} />
              )}
            </dd>
          </div>
          {!g.isClosed && (
            <div className="ui-life-fieldrow">
              <dt>Due</dt>
              <dd>
                <DateInput goalId={goal.id} initial={g.targetDate} onUpdate={g.setTargetDate} />
              </dd>
            </div>
          )}
        </dl>

        {goal.entityId && goal.entityName && (
          <List aria-label="Project">
            <ListRow
              href={`/projects/${goal.entityId}`}
              icon={FolderKanban}
              title={projectTitle({ name: goal.entityName, title: goal.entityTitle })}
              secondary="The project this goal belongs to"
              chevron
            />
          </List>
        )}
      </Section>

      <Section
        title={
          g.milestones.length > 0
            ? `Milestones · ${milestonesDone} of ${g.milestones.length}`
            : "Milestones"
        }
      >
        {g.milestones.length === 0 && g.isClosed && <EmptyState>No milestones</EmptyState>}
        <div>
          {g.milestones.map((m, i) => (
            <MilestoneRow
              key={`${i}:${m.title}`}
              milestone={m}
              goalId={goal.id}
              allMilestones={g.milestones}
              index={i}
              onUpdate={(updated, prog) => {
                g.setMilestones(updated);
                g.setProgress(prog);
              }}
            />
          ))}
        </div>
        {!g.isClosed && (
          <AddMilestoneInline
            goalId={goal.id}
            milestones={g.milestones}
            onAdded={(updated) => g.setMilestones(updated)}
          />
        )}
      </Section>

      {(goal.children.length > 0 || !g.isClosed) && (
        <Section title="Sub-goals">
          {goal.children.length > 0 && <GoalRows goals={goal.children} />}
          {!g.isClosed &&
            (g.addingChild ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    value={g.childTitle}
                    onChange={(e) => g.setChildTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") g.handleAddChild();
                      if (e.key === "Escape") g.setAddingChild(false);
                    }}
                    placeholder="What is the smaller step?"
                    autoFocus
                    aria-label="Sub-goal title"
                    className="ui-input flex-1"
                  />
                  <button
                    type="button"
                    onClick={g.handleAddChild}
                    disabled={!g.childTitle.trim() || g.savingChild}
                    className="ui-btn-secondary shrink-0"
                  >
                    {g.savingChild ? <Loader2 className="ui-spinner-xs" /> : "Add"}
                  </button>
                </div>
                {g.childError && <p className="ui-error-xs">{g.childError}</p>}
              </div>
            ) : (
              <button type="button" onClick={() => g.setAddingChild(true)} className="ui-life-add">
                <Plus className="h-4 w-4" /> Add a sub-goal
              </button>
            ))}
        </Section>
      )}

      {habits.length > 0 && (
        <Section title="Habits that feed it">
          <List aria-label="Habits">
            {habits.map((h) => (
              <ListRow key={h.id} href="/habits" icon={Repeat2} title={h.title} chevron />
            ))}
          </List>
        </Section>
      )}

      <Section title="Actions">
        <SheetActions>
          {!g.isAbandoned && (
            <SheetAction
              icon={g.togglingStatus ? Loader2 : g.isCompleted ? RotateCcw : CheckCircle}
              onClick={g.toggleComplete}
              disabled={g.togglingStatus}
            >
              {g.isCompleted ? "Reopen this goal" : "Mark as finished"}
            </SheetAction>
          )}
          {!g.isCompleted && (
            <SheetAction
              icon={g.abandoningStatus ? Loader2 : g.isAbandoned ? ArchiveRestore : Archive}
              onClick={g.toggleAbandon}
              disabled={g.abandoningStatus}
            >
              {g.isAbandoned ? "Bring it back" : "Set it aside"}
            </SheetAction>
          )}
          {!g.isClosed && (
            <SheetAction icon={Pencil} onClick={() => g.titleEdit.start(g.displayTitle)}>
              Rename
            </SheetAction>
          )}
          {!g.isClosed && (
            <SendToLokiButton {...promptProps} className={SHEET_ACTION} label="Ask Loki about it" />
          )}
          {!g.isClosed && (
            <CopyGoalPromptButton
              {...promptProps}
              className={SHEET_ACTION}
              label="Copy as a prompt for an agent"
            />
          )}
          <DeleteButton
            onDelete={async () => {
              const res = await deleteGoal(goal.id);
              if (!res.ok) throw new Error("Could not delete — try again");
              router.push(back.href);
              router.refresh();
            }}
            label={goal.children.length > 0 ? "Delete it and its sub-goals?" : "Delete this goal?"}
            triggerTitle="Delete goal"
            triggerLabel="Delete goal"
            triggerClassName={SHEET_ACTION_DANGER}
          />
        </SheetActions>
      </Section>
    </PageLayout>
  );
}
