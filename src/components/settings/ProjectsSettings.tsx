"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2, Plus, GripVertical, Pencil, Check, X } from "lucide-react";
import { postJson, deleteJson, patchJson } from "@/lib/api/fetch";
import type { UserProject } from "@/db/schema";
import { cn } from "@/lib/utils";

type Props = {
  projects: UserProject[];
  teamProjects: UserProject[];
  /** null means unlimited (owner or pro/team plan) */
  projectLimit: number | null;
};

export function ProjectsSettings({ projects: initial, teamProjects, projectLimit }: Props) {
  const [projects, setProjects] = useState(initial);
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dirPath, setDirPath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDirPath, setEditDirPath] = useState("");
  const [editGitUrl, setEditGitUrl] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await postJson("/api/user-projects", {
        name: name.trim(),
        dirPath: dirPath.trim() || undefined,
        gitUrl: gitUrl.trim() || undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to add project");
      setProjects((p) => [...p, body]);
      setName("");
      setDirPath("");
      setGitUrl("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: UserProject) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditDirPath(p.dirPath ?? "");
    setEditGitUrl(p.gitUrl ?? "");
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError("");
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditError("");
    try {
      const res = await patchJson(`/api/user-projects/${id}`, {
        name: editName.trim(),
        dirPath: editDirPath.trim() || undefined,
        gitUrl: editGitUrl.trim() || undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save");
      setProjects((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                name: editName.trim(),
                dirPath: editDirPath.trim() || null,
                gitUrl: editGitUrl.trim() || null,
              }
            : p,
        ),
      );
      setEditingId(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setEditSaving(false);
    }
  };

  const remove = async (id: string) => {
    const res = await deleteJson(`/api/user-projects/${id}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to remove project");
      return;
    }
    setProjects((p) => p.filter((x) => x.id !== id));
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    setProjects((prev) => {
      const original = prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      Promise.all(
        next.map((p, i) => patchJson(`/api/user-projects/${p.id}`, { position: i })),
      ).catch(() => {
        setProjects(original);
        setError("Failed to save order — please try again");
      });
      return next;
    });
  };

  const atLimit = projectLimit !== null && projects.length >= projectLimit;

  return (
    <section className="ui-settings-section">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium text-text-primary">Projects</h2>
          {projectLimit !== null && (
            <p className="text-xs text-text-tertiary mt-0.5">
              {projects.length} / {projectLimit} projects
              {atLimit && <span className="ml-1 text-status-warning">· limit reached</span>}
            </p>
          )}
        </div>
        <button
          onClick={() => !atLimit && setAdding((v) => !v)}
          disabled={atLimit}
          title={
            atLimit
              ? `Your plan allows ${projectLimit} projects. See plans to raise the limit.`
              : undefined
          }
          className="ui-btn-secondary py-1.5 text-xs gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {atLimit && (
        <p className="text-sm text-text-secondary bg-surface-raised rounded-lg px-4 py-3">
          You&apos;ve reached the {projectLimit}-project limit on your plan.{" "}
          <a href="/settings#billing" className="ui-link">
            See plans
          </a>{" "}
          for unlimited projects.
        </p>
      )}

      {adding && (
        <div className="ui-settings-subpanel">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Project name"
            className="ui-input"
          />
          <input
            value={dirPath}
            onChange={(e) => setDirPath(e.target.value)}
            placeholder="Local path — optional"
            className="ui-input"
          />
          <input
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            placeholder="GitHub URL — optional"
            className="ui-input"
          />
          {error && <p className="ui-error">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setAdding(false)} className="ui-btn-ghost">
              Cancel
            </button>
            <button onClick={add} disabled={saving || !name.trim()} className="ui-btn-primary">
              {saving && <Loader2 className="ui-spinner-sm" />}
              Add project
            </button>
          </div>
        </div>
      )}

      {error && !adding && <p className="ui-error">{error}</p>}

      {projects.length === 0 ? (
        <p className="text-sm text-text-secondary">No projects yet.</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p, i) => (
            <li
              key={p.id}
              draggable={editingId !== p.id}
              onDragStart={() => {
                dragIndex.current = i;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(i);
              }}
              onDrop={() => {
                if (dragIndex.current !== null && dragIndex.current !== i)
                  reorder(dragIndex.current, i);
                dragIndex.current = null;
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragOver(null);
                dragIndex.current = null;
              }}
              className={cn("ui-list-item group", dragOver === i && "bg-accent-primary/5")}
            >
              <GripVertical
                className={cn(
                  "h-4 w-4 shrink-0 text-text-muted/50",
                  editingId === p.id ? "invisible" : "cursor-grab active:cursor-grabbing",
                )}
              />

              {editingId === p.id ? (
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(p.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    placeholder="Project name"
                    className="ui-input-tight"
                  />
                  <input
                    value={editDirPath}
                    onChange={(e) => setEditDirPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEdit();
                    }}
                    placeholder="Local path"
                    className="ui-input-tight font-mono text-xs"
                  />
                  <input
                    value={editGitUrl}
                    onChange={(e) => setEditGitUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(p.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    placeholder="GitHub URL"
                    className="ui-input-tight"
                  />
                  {editError && <p className="ui-error-xs">{editError}</p>}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => saveEdit(p.id)}
                      disabled={editSaving || !editName.trim()}
                      className="ui-btn-confirm-sm"
                    >
                      {editSaving ? (
                        <Loader2 className="ui-spinner-xs" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      Save
                    </button>
                    <button onClick={cancelEdit} className="ui-link-muted text-xs">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary truncate" title={p.name}>
                    {p.name}
                  </div>
                  {p.dirPath && (
                    <div
                      className="text-xs text-text-tertiary truncate font-mono"
                      title={p.dirPath}
                    >
                      {p.dirPath}
                    </div>
                  )}
                  {p.gitUrl && (
                    <div className="text-xs text-text-tertiary truncate" title={p.gitUrl}>
                      {p.gitUrl}
                    </div>
                  )}
                </div>
              )}

              {editingId !== p.id && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => startEdit(p)}
                    className="ui-hover-reveal ui-btn-row-action"
                    title="Edit project"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    className="ui-hover-reveal ui-btn-ghost shrink-0 p-1.5 hover:text-status-negative"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              {editingId === p.id && (
                <button
                  onClick={cancelEdit}
                  className="shrink-0 ui-btn-row-action self-start mt-0.5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {teamProjects.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border-subtle">
          <p className="ui-kicker">Team projects</p>
          <ul className="space-y-2">
            {teamProjects.map((p) => (
              <li key={p.id} className="ui-list-item opacity-75">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary truncate">{p.name}</div>
                  {p.dirPath && (
                    <div className="text-xs text-text-tertiary truncate font-mono">{p.dirPath}</div>
                  )}
                  {p.gitUrl && (
                    <div className="text-xs text-text-tertiary truncate">{p.gitUrl}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
