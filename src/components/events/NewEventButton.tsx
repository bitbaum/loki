"use client";

import { useId, useState } from "react";
import { ModalForm } from "@/components/ui/modal-form";
import { Field } from "@/components/ui/form";
import { DateInput } from "@/components/ui/date-input";
import { postJson } from "@/lib/api/fetch";
import type { EventRow } from "@/db/queries/events";

const EMPTY = { name: "", type: "", category: "", url: "", deadline: "", description: "" };

/**
 * "New event" — the page's one primary action, a form in a sheet. It used to
 * unfold inside the list's card as six cramped inputs.
 */
export function NewEventButton({
  onCreated,
  existingTypes,
  trigger = "page-action",
  triggerLabel = "New event",
}: {
  onCreated: (event: EventRow) => void;
  existingTypes: string[];
  trigger?: "page-action" | "secondary";
  triggerLabel?: string;
}) {
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const submit = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      // Only what was filled in: an empty field is "not given", not "".
      const body = Object.fromEntries(
        Object.entries(draft)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v !== ""),
      );
      const res = await postJson("/api/events", body);
      const data = (await res.json()) as { event?: EventRow; error?: string };
      if (!res.ok || !data.event) {
        setError(data.error ?? "Could not save — try again");
        return false;
      }
      onCreated(data.event);
      return true;
    } catch {
      setError("Could not reach Loki — try again");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalForm
      trigger={trigger}
      triggerLabel={triggerLabel}
      title="New event"
      submitLabel="Add event"
      savingLabel="Adding…"
      canSubmit={!!draft.name.trim() && !!draft.type.trim()}
      saving={saving}
      error={error}
      onSubmit={submit}
      onReset={() => {
        setDraft(EMPTY);
        setError(null);
      }}
    >
      <Field label="Name" required>
        <input
          value={draft.name}
          onChange={set("name")}
          placeholder="e.g. Swiss Startup Day"
          autoFocus
          className="ui-input"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind" required>
          <input
            value={draft.type}
            onChange={set("type")}
            placeholder="e.g. conference"
            list={existingTypes.length > 0 ? listId : undefined}
            className="ui-input"
          />
          {existingTypes.length > 0 && (
            <datalist id={listId}>
              {existingTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          )}
        </Field>
        <Field label="Deadline">
          <DateInput
            type="date"
            value={draft.deadline}
            onChange={set("deadline")}
            className="ui-input"
          />
        </Field>
      </div>
      <Field label="Link">
        <input
          value={draft.url}
          onChange={set("url")}
          placeholder="https://"
          inputMode="url"
          className="ui-input"
        />
      </Field>
      <Field label="Notes">
        <textarea
          value={draft.description}
          onChange={set("description")}
          rows={2}
          className="ui-input resize-none"
        />
      </Field>
    </ModalForm>
  );
}
