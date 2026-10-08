"use client";

import { useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import type { EventRow } from "@/db/queries/events";
import { DateInput } from "@/components/ui/date-input";

export function AddEventForm({
  onCreated,
  existingTypes = [],
}: {
  onCreated: (event: EventRow) => void;
  existingTypes?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [url, setUrl] = useState("");
  const [deadline, setDeadline] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setName("");
    setType("");
    setUrl("");
    setDeadline("");
    setCategory("");
    setDescription("");
    setError("");
  };

  const submit = async () => {
    if (!name.trim() || !type.trim()) {
      setError("Name and type are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await postJson("/api/events", {
        name,
        type,
        url,
        deadline,
        category,
        description,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      onCreated(data.event as EventRow);
      reset();
      setOpen(false);
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ui-btn-add pt-1">
        <Plus className="h-3.5 w-3.5" /> Add event
      </button>
    );
  }

  return (
    <div className="mt-2 p-3 rounded-lg border border-border-subtle bg-surface-base space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="ui-micro-label">New Event</span>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-text-muted hover:text-text-secondary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {existingTypes.length > 0 && (
        <datalist id="event-type-list">
          {existingTypes.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      )}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Event name *"
        autoFocus
        className="w-full ui-input-compact"
      />
      <div className="flex gap-2">
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="Type * (e.g. workshop)"
          list={existingTypes.length > 0 ? "event-type-list" : undefined}
          className="flex-1 ui-input-compact"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          className="flex-1 ui-input-compact"
        />
      </div>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL (optional)"
          className="flex-1 ui-input-compact"
        />
        <DateInput
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="ui-input-compact"
        />
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setOpen(false);
            reset();
          }
        }}
        placeholder="Description (optional)"
        className="w-full ui-input-compact"
      />
      {error && <p className="ui-error-xs">{error}</p>}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={submit}
          disabled={saving || !name.trim() || !type.trim()}
          className="ui-btn-confirm-sm"
        >
          {saving ? <Loader2 className="ui-spinner-xs" /> : <Plus className="h-3 w-3" />}
          Add
        </button>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="ui-link-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
