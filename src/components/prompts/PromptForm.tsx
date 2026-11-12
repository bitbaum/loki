"use client";

import { useId, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import type { Project } from "./types";
import type { UserPromptCard } from "./UserPromptsSection";

/** Where a save landed: a new prompt, or the identical one already saved. */
export type Saved = { id: string; existing: boolean };

const SCOPE_OPTIONS = [
  { id: "global", label: "Any project", means: "Run it in whichever project you pick." },
  { id: "project", label: "One project", means: "It always runs in the project you pin." },
];

/**
 * New prompt / Edit prompt, as a sheet — the page's one primary action opens
 * it. It used to unfold inline above the list as a bordered card, pushing the
 * prompts a screen down on a phone.
 */
export function PromptForm({
  initial,
  projects,
  notice,
  onCancel,
  onSaved,
}: {
  initial: UserPromptCard | null;
  projects: Project[];
  /** Said at the top — "You already have this prompt saved". */
  notice?: string | null;
  onCancel: () => void;
  onSaved: (saved: Saved) => void;
}) {
  const titleId = useId();
  const isEditing = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [scope, setScope] = useState<"global" | "project">(
    initial?.scope === "project" ? "project" : "global",
  );
  const [projectId, setProjectId] = useState<string>(initial?.projectId ?? "");
  const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What Save is still waiting for, in words — said above the button, which
  // stays pressable only when nothing is. An empty prompt never reaches the
  // API (and the API refuses one anyway: CreatePromptBody).
  const missing = [
    ...(!name.trim() ? ["a name"] : []),
    ...(!body.trim() ? ["the prompt"] : []),
    ...(scope === "project" && !projectId ? ["a project to pin it to"] : []),
  ];
  const missingSentence =
    missing.length > 0
      ? `Add ${missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0]} to save it.`
      : null;

  async function save() {
    setError(null);
    if (missingSentence) return;
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        body: body.trim(),
        scope,
        projectId: scope === "project" ? projectId : null,
        tags,
      };
      const res = await fetch(isEditing ? `/api/prompts/${initial!.id}` : "/api/prompts", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = (await res.json().catch(() => ({}))) as {
        error?: string;
        existing?: boolean;
        prompt?: { id?: string };
      };
      if (!res.ok) {
        setError(b.error ?? "Could not save it. Try again.");
        return;
      }
      onSaved({ id: b.prompt?.id ?? initial?.id ?? "", existing: !!b.existing });
    } catch {
      setError("No connection. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onCancel}
      size="lg"
      position="bottom-mobile"
      padded={false}
      disableClose={saving}
      labelledBy={titleId}
      className="flex flex-col"
    >
      <div className="ui-prompt-sheet-head">
        <h2 id={titleId} className="ui-prompt-sheet-title">
          {isEditing ? "Edit prompt" : "New prompt"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="ui-topbar-btn shrink-0"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="ui-prompt-sheet-body">
        {notice && (
          <p className="text-sm text-text-secondary" role="status">
            {notice}
          </p>
        )}
        <div>
          <label className="ui-prompt-field-label" htmlFor="prompt-name">
            Name
          </label>
          <input
            id="prompt-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily code review"
            className="ui-input"
          />
        </div>

        <div>
          <label className="ui-prompt-field-label" htmlFor="prompt-description">
            What it does <span className="font-normal text-text-tertiary">(optional)</span>
          </label>
          <input
            id="prompt-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line, shown in the list"
            className="ui-input"
          />
        </div>

        <div>
          <label className="ui-prompt-field-label" htmlFor="prompt-body">
            The prompt
          </label>
          <textarea
            id="prompt-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What the agent should do."
            rows={7}
            className="ui-input font-mono text-sm"
          />
          <p className="mt-1.5 text-sm text-text-secondary">
            Write <code>{`{{name}}`}</code> for a blank to fill in when it runs.
          </p>
        </div>

        <Segmented
          label="Where it runs"
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={(id) => setScope(id as "global" | "project")}
        />
        {scope === "project" && (
          <div>
            <label className="ui-prompt-field-label" htmlFor="prompt-project">
              Project
            </label>
            <select
              id="prompt-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="ui-input"
            >
              <option value="">Pick a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="ui-prompt-field-label" htmlFor="prompt-tags">
            Tags <span className="font-normal text-text-tertiary">(optional)</span>
          </label>
          <input
            id="prompt-tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="testing, weekly"
            className="ui-input"
          />
        </div>
      </div>

      <div className="ui-sheet-foot flex flex-col gap-2">
        {error && <p className="ui-prompt-sheet-error">{error}</p>}
        {missingSentence && <p className="text-sm text-text-secondary">{missingSentence}</p>}
        <button
          type="button"
          onClick={save}
          disabled={saving || !!missingSentence}
          className="ui-btn-primary min-h-12 w-full"
        >
          {saving ? <Loader2 className="ui-spinner" /> : null}
          {isEditing ? "Save changes" : "Save prompt"}
        </button>
      </div>
    </Modal>
  );
}
