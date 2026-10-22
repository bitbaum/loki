"use client";

import { useAiForm } from "@fleet/ai-forms/react";
import { ModalForm } from "@/components/ui/modal-form";
import { Field } from "@/components/ui/form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { postJson } from "@/lib/api/fetch";
import { HABIT_FREQUENCY, type HabitFrequency } from "@/lib/constants/statuses";
import { HABIT_FORM } from "@/config/ai-forms";
import { Segmented } from "@/components/ui/segmented";
import { FREQUENCY_LABEL } from "./HabitsList";

export function NewHabitButton({
  trigger = "secondary",
  triggerLabel = "New habit",
}: {
  /** "page-action": the page's one primary action; "secondary" for an empty state. */
  trigger?: "page-action" | "secondary";
  triggerLabel?: string;
} = {}) {
  const form = useAiForm({
    target: HABIT_FORM.key,
    fields: HABIT_FORM.fields,
    // A default, not user intent — HABIT_FORM marks it overridable so a fill
    // may replace it when the description implies a different cadence.
    initialValues: { frequency: HABIT_FREQUENCY.DAILY },
  });
  const { create, saving, error, setError } = useCreateMutation({
    request: (body: { title: string; frequency: HabitFrequency }) => postJson("/api/habits", body),
    errorLabel: "habit",
  });

  const onReset = () => {
    form.reset();
    setError(null);
  };
  const onSubmit = () =>
    create({
      title: form.text("title").trim(),
      frequency: form.text("frequency") as HabitFrequency,
    });

  return (
    <ModalForm
      trigger={trigger}
      triggerLabel={triggerLabel}
      title="New habit"
      submitLabel="Add habit"
      savingLabel="Adding…"
      size="sm"
      canSubmit={!!form.text("title").trim()}
      saving={saving}
      error={error}
      onSubmit={onSubmit}
      onReset={onReset}
      assist={form}
      assistPlaceholder="Describe the habit and I'll fill this in…"
    >
      <Field label="Name" required aiTouched={form.isAiTouched("title")}>
        <input
          value={form.text("title")}
          onChange={(e) => form.setValue("title", e.target.value)}
          placeholder="What do you want to build consistently?"
          autoFocus
          className="ui-input"
        />
      </Field>

      <Field label="How often" aiTouched={form.isAiTouched("frequency")}>
        <Segmented
          label="How often"
          options={Object.values(HABIT_FREQUENCY).map((f) => ({
            id: f,
            label: FREQUENCY_LABEL[f],
          }))}
          value={form.text("frequency") || HABIT_FREQUENCY.DAILY}
          onChange={(id) => form.setValue("frequency", id)}
        />
      </Field>
    </ModalForm>
  );
}
