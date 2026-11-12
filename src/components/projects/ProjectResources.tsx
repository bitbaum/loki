"use client";

import { useState } from "react";
import { ExternalLink, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import type { ProjectResource } from "./project-detail-types";
import { putJson, throwApiError } from "@/lib/api/fetch";

const KINDS: Array<{ value: ProjectResource["kind"]; label: string }> = [
  { value: "link", label: "Link" },
  { value: "doc", label: "Doc" },
  { value: "spec", label: "Spec" },
  { value: "dataset", label: "Dataset" },
  { value: "credential", label: "Credential" },
  { value: "environment", label: "Environment" },
  { value: "design", label: "Design" },
  { value: "other", label: "Other" },
];

const VISIBILITY: Array<{ value: NonNullable<ProjectResource["visibility"]>; label: string }> = [
  { value: "private", label: "Private" },
  { value: "team", label: "Team/advisor" },
  { value: "public", label: "Public" },
];

const SENSITIVITY: Array<{ value: NonNullable<ProjectResource["sensitivity"]>; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "internal", label: "Internal" },
  { value: "secret", label: "Secret" },
  { value: "credential", label: "Credential" },
];

export function ProjectResources({
  projectId,
  resources,
  editable,
  onReload,
}: {
  projectId: string;
  resources: ProjectResource[];
  editable: boolean;
  onReload: () => void;
}) {
  const [items, setItems] = useState<ProjectResource[]>(resources ?? []);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ProjectResource["kind"]>("link");
  const [visibility, setVisibility] =
    useState<NonNullable<ProjectResource["visibility"]>>("private");
  const [sensitivity, setSensitivity] =
    useState<NonNullable<ProjectResource["sensitivity"]>>("normal");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: ProjectResource[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await putJson(`/api/projects/${projectId}/resources`, { resources: next });
      if (!res.ok) await throwApiError(res, "Failed to save resources");
      const json = (await res.json()) as { resources?: ProjectResource[] };
      setItems(json.resources ?? next);
      onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save resources");
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const next: ProjectResource[] = [
      ...items,
      {
        id: crypto.randomUUID(),
        kind,
        visibility,
        sensitivity,
        title: cleanTitle,
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        createdAt: new Date().toISOString(),
      },
    ];
    await save(next);
    setAdding(false);
    setKind("link");
    setVisibility("private");
    setSensitivity("normal");
    setTitle("");
    setUrl("");
    setNotes("");
  }

  async function remove(id: string) {
    await save(items.filter((item) => item.id !== id));
  }

  if (items.length === 0 && !editable) return null;

  return (
    <section aria-labelledby="project-resources-title">
      <div className="flex min-h-11 items-center gap-2 border-b border-border-subtle">
        <FileText className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        <h3 id="project-resources-title" className="text-sm font-medium text-text-primary">
          Resources
        </h3>
        <span className="ui-projects-filter-count">{items.length}</span>
      </div>
      <div className="space-y-3 pt-3">
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-border-subtle bg-surface-raised p-2.5"
              >
                <div className="flex items-start gap-2">
                  <span className="ui-micro-badge shrink-0">{item.kind}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-sm text-accent-text hover:underline"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span className="truncate text-sm text-text-primary">{item.title}</span>
                      )}
                      {item.url && (
                        <ExternalLink
                          className="h-3 w-3 shrink-0 text-text-tertiary"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="ui-micro-badge">{item.visibility ?? "private"}</span>
                      <span className="ui-micro-badge">{item.sensitivity ?? "normal"}</span>
                    </div>
                    {item.notes && (
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-text-muted">
                        {item.notes}
                      </p>
                    )}
                  </div>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      disabled={saving}
                      className="ui-icon-action min-h-11 min-w-11 shrink-0 text-text-muted hover:text-status-negative"
                      title="Remove resource"
                      aria-label={`Remove ${item.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {adding ? (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-raised p-3">
            <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ProjectResource["kind"])}
                className="ui-input min-h-11 w-full"
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Name"
                className="ui-input min-h-11 w-full"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as NonNullable<ProjectResource["visibility"]>)
                }
                className="ui-input min-h-11 w-full"
                aria-label="Resource visibility"
              >
                {VISIBILITY.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
              <select
                value={sensitivity}
                onChange={(e) =>
                  setSensitivity(e.target.value as NonNullable<ProjectResource["sensitivity"]>)
                }
                className="ui-input min-h-11 w-full"
                aria-label="Resource sensitivity"
              >
                {SENSITIVITY.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL, file path, or reference"
              className="ui-input min-h-11 w-full"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes, access details, or why this matters"
              rows={3}
              className="ui-input w-full resize-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={add}
                disabled={saving || !title.trim()}
                className="ui-btn-primary min-h-11 gap-1.5"
              >
                {saving ? <Loader2 className="ui-spinner-xs" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                className="ui-btn-secondary min-h-11"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          editable && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="ui-btn-add-success min-h-11"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add resource
            </button>
          )
        )}
        {error && <p className="ui-error-xs">{error}</p>}
      </div>
    </section>
  );
}
