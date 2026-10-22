"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Archive, ExternalLink, Loader2, Pencil } from "lucide-react";
import {
  DetailSheet,
  SheetAction,
  SheetActions,
  SHEET_ACTION,
  SHEET_ACTION_DANGER,
} from "@/components/ui/detail-sheet";
import { DeleteButton } from "@/components/ui/delete-button";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/form";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { deadlineLabel, toLocalDateStr } from "@/lib/dates";
import { deleteJson, patchJson, throwApiError } from "@/lib/api/fetch";
import { EVENT_STATUS } from "@/lib/constants/statuses";
import type { EventRow } from "@/db/queries/events";

/**
 * One event, opened from its row: what it is, when it is due, its link, and
 * everything you can do with it — edit, ask Loki, archive, delete. These were
 * a `…` menu on every row and an edit form that replaced the row in place.
 */
export function EventSheet({
  event,
  archived,
  onClose,
  onChanged,
  onArchived,
  onDeleted,
}: {
  event: EventRow;
  archived: boolean;
  onClose: () => void;
  onChanged: (updated: EventRow) => void;
  onArchived: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const deadline = event.deadline ? new Date(event.deadline) : null;
  const due = deadlineLabel(deadline);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: event.name,
    deadline: deadline ? toLocalDateStr(deadline) : "",
    url: event.url ?? "",
    description: event.description ?? "",
  });

  const lokiPrompt = [
    `Event: ${event.name}`,
    `Type: ${event.type}`,
    event.category && `Category: ${event.category}`,
    event.location && `Where: ${event.location}`,
    event.dateStart && `When: ${format(new Date(event.dateStart), "d MMM yyyy")}`,
    deadline ? `Deadline: ${due.label} (${format(deadline, "d MMM yyyy")})` : "No deadline set",
    event.description && `Description: ${event.description}`,
    "",
    "What should I do to prepare for or make the most of this before the deadline?",
  ]
    .filter(Boolean)
    .join("\n");

  const save = async () => {
    if (!draft.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await patchJson(`/api/events/${event.id}`, {
        name: draft.name.trim(),
        deadline: draft.deadline || null,
        description: draft.description.trim() || null,
        url: draft.url.trim() || null,
      });
      const json = (await res.json()) as { ok?: boolean; event?: EventRow; error?: string };
      if (!res.ok || !json.event) throw new Error(json.error ?? "Could not save — try again");
      onChanged(json.event);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save — try again");
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await patchJson(`/api/events/${event.id}`, { status: EVENT_STATUS.ARCHIVED });
      if (!res.ok) await throwApiError(res, "Could not archive — try again");
      onArchived(event.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not archive — try again");
    } finally {
      setBusy(false);
    }
  };

  const start = event.dateStart ? new Date(event.dateStart) : null;
  const subtitle = [
    event.type ? event.type.charAt(0).toUpperCase() + event.type.slice(1) : null,
    event.location,
    start && !deadline ? format(start, "EEE d MMM yyyy") : null,
    deadline ? `${due.label} · ${format(deadline, "d MMM yyyy")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <DetailSheet title={event.name} subtitle={subtitle} onClose={onClose}>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Name" required>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              autoFocus
              className="ui-input"
            />
          </Field>
          <Field label="Deadline">
            <DateInput
              type="date"
              value={draft.deadline}
              onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
              className="ui-input"
            />
          </Field>
          <Field label="Link">
            <input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://"
              inputMode="url"
              className="ui-input"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="ui-input resize-none"
            />
          </Field>
          {error && <p className="ui-error-xs">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy || !draft.name.trim()} className="ui-btn-primary">
              {busy && <Loader2 className="ui-spinner-xs" />}
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="ui-btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {event.description ? (
            <p className="ui-life-prose">{event.description}</p>
          ) : (
            <p className="ui-life-prose-empty">No notes</p>
          )}
          {error && <p className="ui-error-xs">{error}</p>}
          <SheetActions>
            {event.url && (
              <SheetAction icon={ExternalLink} href={event.url}>
                Open the link
              </SheetAction>
            )}
            {!archived && (
              <SheetAction icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </SheetAction>
            )}
            {!archived && (
              <LokiDispatchButton
                prompt={lokiPrompt}
                title="Ask Loki about this event"
                label="Ask Loki how to prepare"
                className={SHEET_ACTION}
              />
            )}
            {!archived && (
              <SheetAction icon={busy ? Loader2 : Archive} onClick={archive} disabled={busy}>
                Archive
              </SheetAction>
            )}
            <DeleteButton
              onDelete={async () => {
                const res = await deleteJson(`/api/events/${event.id}`);
                if (!res.ok) await throwApiError(res, "Could not delete — try again");
                onDeleted(event.id);
                onClose();
              }}
              label="Delete this event?"
              triggerTitle="Delete event"
              triggerLabel="Delete event"
              triggerClassName={SHEET_ACTION_DANGER}
            />
          </SheetActions>
        </>
      )}
    </DetailSheet>
  );
}
