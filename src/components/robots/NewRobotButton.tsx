"use client";

import { useAiForm } from "@fleet/ai-forms/react";
import { Field } from "@/components/ui/form";
import { ModalForm } from "@/components/ui/modal-form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { postJson } from "@/lib/api/fetch";
import { ROBOT_FORM } from "@/config/ai-forms";
import { ROBOT_CLASSES, ROBOT_CLASS, ROBOT_CLASS_LABEL, type RobotClass } from "@/config/actors";
import type { CreateRobotInput } from "@/db/queries/robots";

function asRobotClass(value: unknown): RobotClass {
  return typeof value === "string" && (ROBOT_CLASSES as readonly string[]).includes(value)
    ? (value as RobotClass)
    : ROBOT_CLASS.OTHER;
}

export function NewRobotButton({
  onCreated,
  trigger,
}: {
  onCreated?: () => void;
  /** "page-action": the page's one primary action (see ModalForm). */
  trigger?: "button" | "page-action";
} = {}) {
  const form = useAiForm({
    target: ROBOT_FORM.key,
    fields: ROBOT_FORM.fields,
    initialValues: { class: ROBOT_CLASS.VACUUM },
  });
  const { create, saving, error, setError } = useCreateMutation<CreateRobotInput>({
    request: (body) => postJson("/api/robots", body),
    errorLabel: "robot",
  });

  const onReset = () => {
    form.reset();
    setError(null);
  };

  const onSubmit = async () => {
    const ok = await create({
      name: form.text("name").trim(),
      class: asRobotClass(form.text("class")),
      make: form.text("make").trim() || undefined,
      model: form.text("model").trim() || undefined,
      description: form.text("description").trim() || undefined,
    });
    if (ok) onCreated?.();
    return ok;
  };

  return (
    <ModalForm
      trigger={trigger}
      triggerLabel="Add robot"
      title="Add robot"
      submitLabel="Add robot"
      savingLabel="Adding…"
      canSubmit={!!form.text("name").trim()}
      saving={saving}
      error={error}
      onSubmit={onSubmit}
      onReset={onReset}
      assist={form}
      assistPlaceholder="What machine is this? I'll fill this in…"
    >
      <Field label="Name" required aiTouched={form.isAiTouched("name")}>
        <input
          value={form.text("name")}
          onChange={(e) => form.setValue("name", e.target.value)}
          placeholder="e.g. Kitchen Roomba"
          autoFocus
          className="ui-input"
        />
      </Field>
      <Field label="Class" required aiTouched={form.isAiTouched("class")}>
        <select
          value={asRobotClass(form.text("class") || ROBOT_CLASS.VACUUM)}
          onChange={(e) => form.setValue("class", e.target.value)}
          className="ui-input"
        >
          {ROBOT_CLASSES.map((value) => (
            <option key={value} value={value}>
              {ROBOT_CLASS_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Make" aiTouched={form.isAiTouched("make")}>
          <input
            value={form.text("make")}
            onChange={(e) => form.setValue("make", e.target.value)}
            placeholder="e.g. iRobot"
            className="ui-input"
          />
        </Field>
        <Field label="Model" aiTouched={form.isAiTouched("model")}>
          <input
            value={form.text("model")}
            onChange={(e) => form.setValue("model", e.target.value)}
            placeholder="e.g. Roomba j7+"
            className="ui-input"
          />
        </Field>
      </div>
      <Field label="Notes" aiTouched={form.isAiTouched("description")}>
        <input
          value={form.text("description")}
          onChange={(e) => form.setValue("description", e.target.value)}
          placeholder="e.g. Lives under the kitchen sink"
          className="ui-input"
        />
      </Field>
    </ModalForm>
  );
}
