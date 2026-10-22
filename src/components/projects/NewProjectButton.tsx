"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAiForm } from "@fleet/ai-forms/react";
import { Field } from "@/components/ui/form";
import { ModalForm } from "@/components/ui/modal-form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { postJson } from "@/lib/api/fetch";
import { PROJECT_FORM } from "@/config/ai-forms";
import type { CreateProjectInput } from "@/db/queries/projects";

interface Props {
  /** Open the create dialog immediately on mount (deep link: /projects?new=1). */
  autoOpen?: boolean;
  /** Prefill the name field (deep link: /projects?new=1&name=…). */
  initialName?: string;
  /** Prefill the description (deep link: …&description=…). */
  initialDescription?: string;
  /** Controlled by the "New project" choice sheet (NewProjectChooser). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function NewProjectButton({
  autoOpen = false,
  initialName = "",
  initialDescription = "",
  open,
  onOpenChange,
}: Props) {
  const form = useAiForm({
    target: PROJECT_FORM.key,
    fields: PROJECT_FORM.fields,
    initialValues: { name: initialName, description: initialDescription },
  });
  const router = useRouter();
  const { create, saving, error, setError } = useCreateMutation<
    CreateProjectInput,
    { project?: { id?: string } }
  >({
    request: (body) => postJson("/api/projects", body),
    errorLabel: "project",
    // Land on the new project: its kickoff panel is the next step, and the
    // list folds at 25 rows, which hid a just-added project (2026-09-11).
    onCreated: (data) => {
      if (data.project?.id) router.push(`/projects/${data.project.id}`);
    },
  });

  // Deep-link params are one-shot: strip them from the URL so a reload or
  // back-navigation doesn't reopen the dialog after the user dismissed it.
  useEffect(() => {
    if (!autoOpen) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    url.searchParams.delete("name");
    url.searchParams.delete("description");
    window.history.replaceState(null, "", url.toString());
  }, [autoOpen]);

  const onReset = () => {
    form.reset();
    setError(null);
  };

  const onSubmit = () =>
    create({
      name: form.text("name").trim(),
      description: form.text("description").trim() || undefined,
    });

  return (
    <ModalForm
      title="Add an existing project"
      submitLabel="Add project"
      trigger={open === undefined ? "button" : "none"}
      open={open}
      onOpenChange={onOpenChange}
      savingLabel="Adding…"
      defaultOpen={autoOpen}
      canSubmit={!!form.text("name").trim()}
      saving={saving}
      error={error}
      onSubmit={onSubmit}
      onReset={onReset}
      assist={form}
      assistPlaceholder="Describe the project and I'll fill this in…"
    >
      <Field label="Name" required aiTouched={form.isAiTouched("name")}>
        <input
          value={form.text("name")}
          onChange={(e) => form.setValue("name", e.target.value)}
          placeholder="e.g. OrangeCat"
          autoFocus
          className="ui-input"
        />
      </Field>
      <Field label="Description" aiTouched={form.isAiTouched("description")}>
        <input
          value={form.text("description")}
          onChange={(e) => form.setValue("description", e.target.value)}
          placeholder="e.g. Bitcoin marketplace"
          className="ui-input"
        />
      </Field>
    </ModalForm>
  );
}
