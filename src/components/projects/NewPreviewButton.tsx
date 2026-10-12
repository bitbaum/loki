"use client";

import { useRouter } from "next/navigation";
import { useAiForm } from "@fleet/ai-forms/react";
import { Field } from "@/components/ui/form";
import { ModalForm } from "@/components/ui/modal-form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { postJson } from "@/lib/api/fetch";
import { PREVIEW_FORM } from "@/config/ai-forms";

/**
 * "Build a preview for…" — a first version of someone's site, made before
 * they are a customer: no repository, a private link behind the studio's
 * access code, and Loki's widget on it so they can say what to change.
 * Lands on the new project, which shows the link and the owner link.
 */
export function NewPreviewButton() {
  const form = useAiForm({
    target: PREVIEW_FORM.key,
    fields: PREVIEW_FORM.fields,
    initialValues: { name: "", about: "" },
  });
  const router = useRouter();
  const { create, saving, error, setError } = useCreateMutation<
    { name: string; about?: string },
    { preview?: { projectId?: string } }
  >({
    request: (body) => postJson("/api/previews", body),
    errorLabel: "preview",
    onCreated: (data) => {
      if (data.preview?.projectId) router.push(`/projects/${data.preview.projectId}`);
    },
  });

  return (
    <ModalForm
      title="Build a preview"
      triggerLabel="Build a preview"
      submitLabel="Build it"
      savingLabel="Starting…"
      canSubmit={!!form.text("name").trim()}
      saving={saving}
      error={error}
      onSubmit={() =>
        create({
          name: form.text("name").trim(),
          about: form.text("about").trim() || undefined,
        })
      }
      onReset={() => {
        form.reset();
        setError(null);
      }}
      assist={form}
      assistPlaceholder="Paste what you have about them and I'll fill this in…"
    >
      <Field label="Who it is for" required aiTouched={form.isAiTouched("name")}>
        <input
          value={form.text("name")}
          onChange={(e) => form.setValue("name", e.target.value)}
          placeholder="e.g. Francesco Tarallo"
          autoFocus
          className="ui-input"
        />
      </Field>
      <Field label="What you know (links, place, trade)" aiTouched={form.isAiTouched("about")}>
        <textarea
          value={form.text("about")}
          onChange={(e) => form.setValue("about", e.target.value)}
          placeholder="e.g. DJ in Zurich, dub techno. ra.co/dj/francescotarallo"
          rows={4}
          className="ui-input"
        />
      </Field>
    </ModalForm>
  );
}
