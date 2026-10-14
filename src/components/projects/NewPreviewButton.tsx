"use client";

import { useRef, useState } from "react";
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
    initialValues: { name: "", about: "", address: "" },
  });
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const { create, saving, error, setError } = useCreateMutation<
    { name: string; about?: string; address?: string },
    { preview?: { projectId?: string } }
  >({
    // A finished site travels as multipart; otherwise it is asked for as JSON.
    request: (body) => {
      if (!archive) return postJson("/api/previews", body);
      const data = new FormData();
      for (const [key, value] of Object.entries(body)) if (value) data.append(key, value);
      data.append("archive", archive);
      return fetch("/api/previews", { method: "POST", body: data });
    },
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
          address: form.text("address").trim() || undefined,
        })
      }
      onReset={() => {
        form.reset();
        setArchive(null);
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
      <Field label="Address (empty uses the name)" aiTouched={form.isAiTouched("address")}>
        <input
          value={form.text("address")}
          onChange={(e) => form.setValue("address", e.target.value)}
          placeholder="e.g. francesco  →  francesco.orangecat.ch"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="ui-input"
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="ui-micro-label">Already have the site? Bring it as a .zip</span>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          onChange={(e) => setArchive(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="ui-btn-chip self-start"
          onClick={() => fileRef.current?.click()}
        >
          {archive ? `${archive.name} — change` : "Choose a .zip (index.html at the top)"}
        </button>
      </div>
    </ModalForm>
  );
}
