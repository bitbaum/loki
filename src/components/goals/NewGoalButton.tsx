"use client";

import { useAiForm } from "@fleet/ai-forms/react";
import type { GoalWithChildren } from "@/db/queries/goals";
import { createGoal } from "@/lib/api/goals";
import { GOAL_STATUS } from "@/lib/constants/statuses";
import { GOAL_FORM } from "@/config/ai-forms";
import { Field } from "@/components/ui/form";
import { ModalForm } from "@/components/ui/modal-form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { DateInput } from "@/components/ui/date-input";

export function NewGoalButton({ goals }: { goals: GoalWithChildren[] }) {
  // One store for the whole form. The user types into it and the assistant
  // writes into it — which is what makes "now move the target date" work.
  const form = useAiForm({ target: GOAL_FORM.key, fields: GOAL_FORM.fields });
  const { create, saving, error, setError } = useCreateMutation({
    request: createGoal,
    errorLabel: "goal",
  });

  const onReset = () => {
    form.reset();
    setError(null);
  };

  const onSubmit = () =>
    create({
      title: form.text("title").trim(),
      description: form.text("description").trim() || undefined,
      targetDate: form.text("targetDate") || undefined,
      parentGoalId: form.text("parentGoalId") || undefined,
    });

  // Flatten goal tree for parent selector (exclude completed goals)
  const flatGoals: Array<{ id: string; title: string; depth: number }> = [];
  function flatten(list: GoalWithChildren[], depth: number) {
    for (const g of list) {
      if (g.status !== GOAL_STATUS.COMPLETED) {
        flatGoals.push({ id: g.id, title: g.title, depth });
        flatten(g.children, depth + 1);
      }
    }
  }
  flatten(goals, 0);

  return (
    <ModalForm
      triggerLabel="New Goal"
      title="New Goal"
      submitLabel="Create Goal"
      savingLabel="Creating…"
      size="md"
      canSubmit={!!form.text("title").trim()}
      saving={saving}
      error={error}
      onSubmit={onSubmit}
      onReset={onReset}
      assist={form}
      assistPlaceholder="Describe the goal and I'll fill this in…"
    >
      <Field label="Title" required aiTouched={form.isAiTouched("title")}>
        <input
          value={form.text("title")}
          onChange={(e) => form.setValue("title", e.target.value)}
          placeholder="What are you working toward?"
          autoFocus
          className="ui-input"
        />
      </Field>

      <Field label="Description" aiTouched={form.isAiTouched("description")}>
        <textarea
          value={form.text("description")}
          onChange={(e) => form.setValue("description", e.target.value)}
          placeholder="Optional context or motivation"
          rows={2}
          className="ui-input resize-none"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Target Date" aiTouched={form.isAiTouched("targetDate")}>
          <DateInput
            type="date"
            value={form.text("targetDate")}
            onChange={(e) => form.setValue("targetDate", e.target.value)}
            className="ui-input"
          />
        </Field>

        {flatGoals.length > 0 && (
          <Field label="Parent Goal">
            <select
              value={form.text("parentGoalId")}
              onChange={(e) => form.setValue("parentGoalId", e.target.value)}
              className="ui-input"
            >
              <option value="">— None —</option>
              {flatGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {"  ".repeat(g.depth)}
                  {g.depth > 0 ? "↳ " : ""}
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </ModalForm>
  );
}
