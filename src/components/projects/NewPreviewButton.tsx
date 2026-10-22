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
export function NewPreviewButton({
  savedCode = "",
  open,
  onOpenChange,
}: {
  savedCode?: string;
  /** Controlled by the "New project" choice sheet (NewProjectChooser). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const form = useAiForm({
    target: PREVIEW_FORM.key,
    fields: PREVIEW_FORM.fields,
    initialValues: { name: "", about: "", address: "", code: savedCode },
  });
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const { create, saving, error, setError } = useCreateMutation<
    { name: string; about?: string; address?: string; code?: string },
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

  const missing = [
    !form.text("name").trim() ? "who it is for" : null,
    form.text("code").trim().length < 3 ? "an access code (3 letters or more)" : null,
  ].filter((m): m is string => m !== null);

  return (
    <ModalForm
      title="Build a site"
      triggerLabel="Build a site"
      trigger={open === undefined ? "button" : "none"}
      open={open}
      onOpenChange={onOpenChange}
      submitLabel="Build it"
      savingLabel="Starting…"
      canSubmit={missing.length === 0}
      saving={saving}
      error={error}
      onSubmit={() =>
        create({
          name: form.text("name").trim(),
          about: form.text("about").trim() || undefined,
          address: form.text("address").trim() || undefined,
          code: form.text("code").trim() || undefined,
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
      <Field label="Who is it for?" required aiTouched={form.isAiTouched("name")}>
        <input
          value={form.text("name")}
          onChange={(e) => form.setValue("name", e.target.value)}
          placeholder="e.g. Francesco Tarallo"
          autoFocus
          className="ui-input"
        />
      </Field>
      <Field
        label="What do you know about them?"
        hint="Links, where they are, what they do — the more, the closer the first version."
        aiTouched={form.isAiTouched("about")}
      >
        <textarea
          value={form.text("about")}
          onChange={(e) => form.setValue("about", e.target.value)}
          placeholder="e.g. DJ in Zurich, dub techno. ra.co/dj/francescotarallo"
          rows={4}
          className="ui-input"
        />
      </Field>
      <Field
        label="Web address"
        hint="Leave it empty to use their name."
        aiTouched={form.isAiTouched("address")}
      >
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
      <Field
        label="Access code"
        hint="Anyone with the link needs this word to open it. You tell it to them; Loki remembers it for next time."
        required
      >
        <input
          value={form.text("code")}
          onChange={(e) => form.setValue("code", e.target.value)}
          placeholder="any word, e.g. cat"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="ui-input"
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="ui-micro-label">Already have their site? Upload it as a .zip</span>
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
      {/* "Build it" stays grey until these are in; say which, not nothing. */}
      {missing.length > 0 && (
        <p className="ui-field-hint">To build it, add {missing.join(" and ")}.</p>
      )}
    </ModalForm>
  );
}
