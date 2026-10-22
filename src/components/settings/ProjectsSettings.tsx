"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { postJson, deleteJson, patchJson } from "@/lib/api/fetch";
import type { UserProject } from "@/db/schema";
import { projectTitle } from "@/lib/project-display";
import { DetailSheet, SheetAction, SheetActions } from "@/components/ui/detail-sheet";
import { List, ListRow } from "@/components/ui/list-row";
import { RowActions } from "@/components/ui/row-actions";
import { Section } from "@/components/ui/section-heading";

type Props = {
  projects: UserProject[];
  teamProjects: UserProject[];
  /** null means unlimited (owner or pro/team plan) */
  projectLimit: number | null;
};

/** Where a project's code lives, in words — never the path or the address. */
function whereItLives(p: UserProject): string {
  if (p.gitUrl && p.dirPath) return "GitHub and your computer";
  if (p.gitUrl) return "On GitHub";
  if (p.dirPath) return "Your computer";
  return "No code connected yet";
}

type Draft = { name: string; dirPath: string; gitUrl: string };
const EMPTY: Draft = { name: "", dirPath: "", gitUrl: "" };

/**
 * Settings → Projects: every project as a row, its order and details one tap
 * away. Reordering is "Move up / Move down" in the row's menu — the drag
 * handle it replaced does not exist on a phone — and removing asks twice, in
 * the sheet that edits the project, so the menu never holds a one-tap delete.
 */
export function ProjectsSettings({ projects: initial, teamProjects, projectLimit }: Props) {
  const [projects, setProjects] = useState(initial);
  const [error, setError] = useState("");
  // null = closed, "new" = adding, otherwise the project being edited.
  const [sheet, setSheet] = useState<UserProject | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const atLimit = projectLimit !== null && projects.length >= projectLimit;

  const open = (target: UserProject | "new") => {
    setSheet(target);
    setSheetError("");
    setConfirmRemove(false);
    setDraft(
      target === "new"
        ? EMPTY
        : { name: target.name, dirPath: target.dirPath ?? "", gitUrl: target.gitUrl ?? "" },
    );
  };
  const close = () => setSheet(null);

  const save = async () => {
    if (!draft.name.trim() || sheet === null) return;
    setSaving(true);
    setSheetError("");
    const fields = {
      name: draft.name.trim(),
      dirPath: draft.dirPath.trim() || undefined,
      gitUrl: draft.gitUrl.trim() || undefined,
    };
    try {
      if (sheet === "new") {
        const res = await postJson("/api/user-projects", fields);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not add the project");
        setProjects((p) => [...p, body]);
      } else {
        const res = await patchJson(`/api/user-projects/${sheet.id}`, fields);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not save");
        setProjects((prev) =>
          prev.map((p) =>
            p.id === sheet.id
              ? {
                  ...p,
                  name: fields.name,
                  dirPath: fields.dirPath ?? null,
                  gitUrl: fields.gitUrl ?? null,
                }
              : p,
          ),
        );
      }
      close();
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const res = await deleteJson(`/api/user-projects/${id}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setSheetError(body.error ?? "Could not remove the project");
      return;
    }
    setProjects((p) => p.filter((x) => x.id !== id));
    close();
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= projects.length) return;
    const original = projects;
    const next = [...projects];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setProjects(next);
    Promise.all(next.map((p, i) => patchJson(`/api/user-projects/${p.id}`, { position: i }))).catch(
      () => {
        setProjects(original);
        setError("Could not save the order — try again");
      },
    );
  };

  return (
    <section className="ui-settings-section">
      <Section
        title="Your projects"
        right={
          <button
            type="button"
            onClick={() => open("new")}
            disabled={atLimit}
            title={atLimit ? `Your plan allows ${projectLimit} projects.` : undefined}
            className="ui-btn-secondary min-h-9 gap-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add
          </button>
        }
      >
        {projectLimit !== null && (
          <p className="ui-settings-lede">
            {projects.length} of {projectLimit} projects.
            {atLimit && (
              <>
                {" "}
                That is the limit on your plan. <Link href="/settings#billing">See plans</Link> for
                more room.
              </>
            )}
          </p>
        )}
        {error && <p className="ui-error">{error}</p>}
        {projects.length === 0 ? (
          <p className="ui-settings-lede">No projects yet.</p>
        ) : (
          <List aria-label="Your projects">
            {projects.map((p, i) => (
              <ListRow
                key={p.id}
                avatar={projectTitle(p).charAt(0).toUpperCase()}
                title={projectTitle(p)}
                secondary={whereItLives(p)}
                onClick={() => open(p)}
                menu={
                  <RowActions label={`More for ${projectTitle(p)}`}>
                    <button
                      type="button"
                      onClick={() => open(p)}
                      className="ui-menu-item"
                      role="menuitem"
                    >
                      <Pencil className="h-4 w-4 shrink-0" />
                      Edit
                    </button>
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={() => move(i, i - 1)}
                        className="ui-menu-item"
                        role="menuitem"
                      >
                        <ArrowUp className="h-4 w-4 shrink-0" />
                        Move up
                      </button>
                    )}
                    {i < projects.length - 1 && (
                      <button
                        type="button"
                        onClick={() => move(i, i + 1)}
                        className="ui-menu-item"
                        role="menuitem"
                      >
                        <ArrowDown className="h-4 w-4 shrink-0" />
                        Move down
                      </button>
                    )}
                  </RowActions>
                }
              />
            ))}
          </List>
        )}
      </Section>

      {teamProjects.length > 0 && (
        <Section title="Team projects">
          <List aria-label="Team projects">
            {teamProjects.map((p) => (
              <ListRow
                key={p.id}
                avatar={projectTitle(p).charAt(0).toUpperCase()}
                title={projectTitle(p)}
                secondary={whereItLives(p)}
              />
            ))}
          </List>
        </Section>
      )}

      {sheet !== null && (
        <DetailSheet
          title={sheet === "new" ? "Add a project" : projectTitle(sheet)}
          subtitle={sheet === "new" ? undefined : whereItLives(sheet)}
          onClose={close}
        >
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="ui-settings-lede">Name</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && save()}
                className="ui-input"
              />
            </label>
            <label className="block space-y-1">
              <span className="ui-settings-lede">Folder on your computer (optional)</span>
              <input
                value={draft.dirPath}
                onChange={(e) => setDraft({ ...draft, dirPath: e.target.value })}
                className="ui-input font-mono text-xs"
              />
            </label>
            <label className="block space-y-1">
              <span className="ui-settings-lede">GitHub address (optional)</span>
              <input
                value={draft.gitUrl}
                onChange={(e) => setDraft({ ...draft, gitUrl: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && save()}
                className="ui-input"
              />
            </label>
            {sheetError && <p className="ui-error">{sheetError}</p>}
            <button
              type="button"
              onClick={save}
              disabled={saving || !draft.name.trim()}
              className="ui-btn-primary w-full gap-2"
            >
              {saving && <Loader2 className="ui-spinner-sm" />}
              {sheet === "new" ? "Add project" : "Save"}
            </button>
          </div>
          {sheet !== "new" && (
            <SheetActions>
              {confirmRemove ? (
                <SheetAction icon={Trash2} danger onClick={() => remove(sheet.id)}>
                  Yes, remove {projectTitle(sheet)}
                </SheetAction>
              ) : (
                <SheetAction icon={Trash2} danger onClick={() => setConfirmRemove(true)}>
                  Remove from Loki
                </SheetAction>
              )}
            </SheetActions>
          )}
        </DetailSheet>
      )}
    </section>
  );
}
