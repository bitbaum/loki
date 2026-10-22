"use client";

import { useAiForm } from "@fleet/ai-forms/react";
import { Field } from "@/components/ui/form";
import { ModalForm } from "@/components/ui/modal-form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { postJson } from "@/lib/api/fetch";
import { PERSON_FORM } from "@/config/ai-forms";
import type { CreatePersonInput } from "@/db/queries/people";

export function NewPersonButton({
  onCreated,
  trigger,
}: {
  onCreated?: () => void;
  /** "page-action": the page's one primary action (see ModalForm). */
  trigger?: "button" | "page-action" | "secondary";
} = {}) {
  const form = useAiForm({ target: PERSON_FORM.key, fields: PERSON_FORM.fields });
  const { create, saving, error, setError } = useCreateMutation<CreatePersonInput>({
    request: (body) => postJson("/api/people", body),
    errorLabel: "person",
  });

  const onReset = () => {
    form.reset();
    setError(null);
  };

  const onSubmit = async () => {
    const ok = await create({
      name: form.text("name").trim(),
      description: form.text("description").trim() || undefined,
    });
    if (ok) onCreated?.();
    return ok;
  };

  return (
    <ModalForm
      trigger={trigger}
      triggerLabel="Add person"
      title="Add a person"
      submitLabel="Add person"
      savingLabel="Adding…"
      canSubmit={!!form.text("name").trim()}
      saving={saving}
      error={error}
      onSubmit={onSubmit}
      onReset={onReset}
      assist={form}
      assistPlaceholder="Who are they? I'll fill this in…"
    >
      <Field label="Name" required aiTouched={form.isAiTouched("name")}>
        <input
          value={form.text("name")}
          onChange={(e) => form.setValue("name", e.target.value)}
          placeholder="e.g. Jane Smith"
          autoFocus
          className="ui-input"
        />
      </Field>
      <Field label="Notes" aiTouched={form.isAiTouched("description")}>
        <input
          value={form.text("description")}
          onChange={(e) => form.setValue("description", e.target.value)}
          placeholder="e.g. Met at ETH conference"
          className="ui-input"
        />
      </Field>
    </ModalForm>
  );
}
