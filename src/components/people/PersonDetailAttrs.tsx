"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { setAttr, removeAttr } from "@/lib/api/attrs";
import { throwApiError } from "@/lib/api/fetch";
import { isChannelAttrKey } from "@/config/channels";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "./PersonDetailHelpers";
import { formatKey } from "./person-detail-types";

export function DetailAttrs({
  personId,
  attrs,
  onUpdate,
}: {
  personId: string;
  attrs: Record<string, string>;
  onUpdate: (updated: Record<string, string>) => void;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const detailAttrs = Object.entries(attrs).filter(
    ([k]) => !isChannelAttrKey(k) && k !== "aliases",
  );

  const saveEdit = async (key: string) => {
    if (!editValue.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await setAttr(`/api/people/${personId}`, key, editValue.trim());
      if (!res.ok) await throwApiError(res, "Failed to save");
      onUpdate({ ...attrs, [key]: editValue.trim() });
      setEditingKey(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const saveNew = async () => {
    if (!newKey.trim() || !newValue.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await setAttr(`/api/people/${personId}`, newKey.trim(), newValue.trim());
      if (!res.ok) await throwApiError(res, "Failed to save");
      const normalizedKey = newKey.trim().toLowerCase().replace(/\s+/g, "_");
      onUpdate({ ...attrs, [normalizedKey]: newValue.trim() });
      setNewKey("");
      setNewValue("");
      setAddingNew(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const deleteAttr = async (key: string) => {
    setDeletingKey(key);
    setDeleteError(null);
    try {
      const res = await removeAttr(`/api/people/${personId}`, key);
      if (!res.ok) await throwApiError(res, "Failed to delete");
      const next = { ...attrs };
      delete next[key];
      onUpdate(next);
      setEditingKey(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <Section title="Details">
      {detailAttrs.map(([key, value]) => (
        <div key={key} className="group flex justify-between gap-3 ui-person-row">
          <span className="shrink-0 text-text-secondary">{formatKey(key)}</span>
          {editingKey === key ? (
            <div className="flex flex-1 flex-col items-end gap-1">
              <div className="flex w-full items-center justify-end gap-1">
                <input
                  value={editValue}
                  onChange={(e) => {
                    setEditValue(e.target.value);
                    setSaveError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(key);
                    if (e.key === "Escape") {
                      setEditingKey(null);
                      setSaveError(null);
                    }
                  }}
                  autoFocus
                  className="min-w-0 flex-1 ui-input text-right"
                />
                <button
                  onClick={() => saveEdit(key)}
                  disabled={saving}
                  className="ui-btn-icon-accent p-1"
                >
                  {saving ? <Loader2 className="ui-spinner-sm" /> : <Save className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => {
                    setEditingKey(null);
                    setSaveError(null);
                  }}
                  className="shrink-0 ui-btn-icon"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  onClick={() => deleteAttr(key)}
                  disabled={deletingKey === key}
                  className="shrink-0 ui-btn-icon hover:text-status-negative"
                  title="Delete attribute"
                >
                  {deletingKey === key ? (
                    <Loader2 className="ui-spinner-sm" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
              {saveError && <p className="ui-error-xs">{saveError}</p>}
              {deleteError && <p className="ui-error-xs">{deleteError}</p>}
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-right text-text-primary" title={value}>
                {value}
              </span>
              <button
                onClick={() => {
                  setEditValue(value);
                  setEditingKey(key);
                }}
                className="shrink-0 ui-hover-reveal ui-btn-icon"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      ))}
      {detailAttrs.length === 0 && !addingNew && <EmptyState>Nothing else noted.</EmptyState>}
      {addingNew ? (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center gap-1.5">
            <input
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value);
                setSaveError(null);
              }}
              placeholder="What"
              className="w-28 ui-input"
            />
            <input
              value={newValue}
              onChange={(e) => {
                setNewValue(e.target.value);
                setSaveError(null);
              }}
              placeholder="Value"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNew();
                if (e.key === "Escape") {
                  setAddingNew(false);
                  setNewKey("");
                  setNewValue("");
                  setSaveError(null);
                }
              }}
              autoFocus
              className="flex-1 ui-input"
            />
            <button
              onClick={saveNew}
              disabled={!newKey.trim() || !newValue.trim() || saving}
              className="ui-btn-icon-accent p-1.5"
            >
              {saving ? <Loader2 className="ui-spinner-xs" /> : <Save className="h-3 w-3" />}
            </button>
            <button
              onClick={() => {
                setAddingNew(false);
                setNewKey("");
                setNewValue("");
                setSaveError(null);
              }}
              className="ui-btn-icon"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {saveError && <p className="ui-error-xs">{saveError}</p>}
        </div>
      ) : (
        <button onClick={() => setAddingNew(true)} className="ui-life-add">
          <Plus className="h-4 w-4" /> Add a detail
        </button>
      )}
    </Section>
  );
}
