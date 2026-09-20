"use client";

// User-owned prompts section on /prompts. Renders ABOVE the Loki
// defaults so the user's own prompts are first-class — they grow over
// time as the user works and become more relevant than the seed catalog.
//
// v2.1a (this file): list + create. v2.1b adds edit + delete on each card.
// v2.2 adds the variables modal for {{name}} placeholders at run time.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X, Pencil, Zap, Clock } from "lucide-react";
import type { Project } from "./types";
import type { PromptTemplate } from "@/config/prompt-library";
import { RunModal } from "./RunModal";
import { ScheduleModal } from "./ScheduleModal";
import { SAVED_PROMPTS_TITLE } from "@/config/control-labels";
import { RowActions } from "@/components/ui/row-actions";
import { DeleteButton } from "@/components/ui/delete-button";
import { timeAgo } from "@/lib/dates";

/**
 * Adapt a user-owned prompt into the PromptTemplate shape the existing
 * RunModal / ScheduleModal consume. Run + Schedule are identical flows for
 * user prompts and FC defaults — the only difference is where the body comes
 * from — so we reuse the exact same modals instead of re-rolling the run UI.
 *
 * Scope mapping: the modals only understand "global" | "project". An "org"
 * prompt has no per-project picker, so it runs as "global" (the body is the
 * whole instruction; org just controls who can see it in the library).
 */
function asTemplate(p: UserPromptCard): PromptTemplate {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: "fleet",
    scope: p.scope === "project" ? "project" : "global",
    template: p.body,
  };
}

export interface UserPromptCard {
  id: string;
  name: string;
  description: string;
  body: string;
  scope: "global" | "project" | "org";
  projectId: string | null;
  orgId: string | null;
  tags: string[];
  source: string;
  forkedFromKey: string | null;
  runCount: number;
  successCount: number;
  updatedAt: string;
}

/** \u0000 escape, not a literal NUL: the raw byte made this file read as
 *  binary to grep, diff and most editors. */
export const dupeKey = (p: UserPromptCard) => `${p.name}\u0000${p.body}`;

/**
 * Collapse exact duplicates (same name + body), and count how many there were.
 *
 * A smoke session once forked the same default six times and the section
 * rendered "Next Best Step" ×7, so this dedupes at render and the newest copy
 * wins (the list arrives most-recent first).
 *
 * It returns the COUNT as well, because hiding the copies silently made delete
 * look broken: the card stands for a whole group, so deleting it drew the next
 * identical row in its place and the prompt appeared to come back. Measured on
 * prod 2026-09-18: 8 rows named "Next Best Step", two groups of four, rendering
 * as two cards over a header that said "2 saved".
 */
export function collapseDuplicates(prompts: UserPromptCard[]): {
  visible: UserPromptCard[];
  copies: Map<string, number>;
} {
  const copies = new Map<string, number>();
  for (const p of prompts) copies.set(dupeKey(p), (copies.get(dupeKey(p)) ?? 0) + 1);
  const seen = new Set<string>();
  const visible = prompts.filter((p) => {
    const key = dupeKey(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { visible, copies };
}

export function UserPromptsSection({
  prompts,
  projects,
}: {
  prompts: UserPromptCard[];
  projects: Project[];
}) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  // DeleteButton owns the per-row deleting/erroring state now, so this
  // component no longer tracks which id is mid-delete.
  const [, startTransition] = useTransition();

  /**
   * Confirmation is the shared two-step DeleteButton, like every other delete
   * in the app — this was the one call site using a native `confirm()`, which
   * looks foreign, cannot be styled, and blocks the whole tab.
   *
   * It also used to swallow a failed response: `if (res.ok) refresh()` with no
   * else, so a delete that failed looked exactly like one that worked until
   * the row reappeared on the next load. Throwing lets DeleteButton say so.
   */
  async function handleDelete(id: string) {
    const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Could not delete this prompt — try again");
    startTransition(() => router.refresh());
  }

  const editingPrompt = editingId ? (prompts.find((p) => p.id === editingId) ?? null) : null;
  const runningPrompt = runId ? (prompts.find((p) => p.id === runId) ?? null) : null;
  const schedulingPrompt = scheduleId ? (prompts.find((p) => p.id === scheduleId) ?? null) : null;

  const { visible: visiblePrompts, copies } = collapseDuplicates(prompts);

  return (
    <section className="space-y-3">
      {/* gap + shrink-0 + nowrap. Without them the row had no gutter and the
          button was allowed to shrink, so on a 358px phone row "New prompt"
          wrapped to two lines inside a 92px pill pressed against the sentence
          beside it. */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="ui-page-subtitle">{SAVED_PROMPTS_TITLE}</h2>
          <p className="text-sm text-text-muted">
            {visiblePrompts.length === 0
              ? "Reusable templates you write — separate from dispatches on Control."
              : `${visiblePrompts.length} saved · most-recent first`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setIsCreating(true);
          }}
          className="ui-btn-primary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm"
        >
          <Plus className="h-3.5 w-3.5" />
          New prompt
        </button>
      </header>

      {(isCreating || editingPrompt) && (
        <PromptForm
          initial={editingPrompt}
          projects={projects}
          onCancel={() => {
            setIsCreating(false);
            setEditingId(null);
          }}
          onSaved={() => {
            setIsCreating(false);
            setEditingId(null);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {/* No full empty-state card here: the header already says "Build your own
          library" with the New prompt button, and the forkable Loki
          defaults render immediately below. A padded card repeating that was a
          dead band — costly on mobile. One muted line keeps the fork pointer. */}
      {visiblePrompts.length === 0 && !isCreating && (
        <p className="text-xs text-text-muted">
          …or fork a Loki default below to make it your own.
        </p>
      )}

      {visiblePrompts.length > 0 && (
        // Cap columns to the number of saved prompts so 1–2 don't sit stranded
        // at 1/3 width in a fixed 3-col grid (the section usually has few items).
        <div
          className={`grid gap-3 ${
            visiblePrompts.length === 1
              ? "max-w-md grid-cols-1"
              : visiblePrompts.length === 2
                ? "grid-cols-1 sm:grid-cols-2"
                : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {visiblePrompts.map((p) => {
            const projectName = p.projectId
              ? (projects.find((pr) => pr.id === p.projectId)?.name ?? "(deleted project)")
              : null;
            return (
              <article
                key={p.id}
                className="ui-card-shell-raised p-4 flex flex-col gap-2 hover:border-accent-primary transition-colors"
              >
                <header className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-text-primary truncate">{p.name}</h3>
                    {/* One summary per card. This used to render the
                        description here AND the whole body in a <pre> below,
                        so every card said the same thing twice — and the
                        second copy was cut mid-word, because `line-clamp-4` on
                        a `<pre class="overflow-hidden">` is inert: the
                        overflow makes the box a flow-root, and -webkit-box is
                        what line-clamp needs. `max-h-24` did the clipping
                        instead, which cuts through a line rather than after
                        one. The body is what Edit opens. */}
                    <p className="text-xs text-text-muted line-clamp-2 mt-0.5">
                      {p.description || p.body}
                    </p>
                    {/* The header promises "most-recent first" and the card hid
                        the only field that claim rests on. It costs a line and
                        it is the difference between two cards you cannot tell
                        apart: the summary above is clamped to two lines, so two
                        prompts that share a name and diverge later in the body
                        render identically — which is exactly what /prompts
                        showed on 2026-09-18, two "Next Best Step" cards side by
                        side. The dedupe above is right to keep them (they DO
                        differ); this says which is which. */}
                    <p className="text-micro text-text-muted mt-1">
                      saved {timeAgo(new Date(p.updatedAt).getTime())}
                      {p.runCount > 0 ? ` · run ${p.runCount}×` : " · never run"}
                      {(copies.get(dupeKey(p)) ?? 1) > 1
                        ? ` · ${copies.get(dupeKey(p))} identical copies saved`
                        : ""}
                    </p>
                  </div>
                  {/* Running it is what a saved prompt is FOR, so that stays a
                      button. Schedule/edit/delete are once-in-a-while, and four
                      equal glyphs on every card made the reader work out which
                      was which, per card, every time. */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setRunId(p.id)}
                      className="ui-btn-icon text-accent-text hover:text-accent-hover"
                      aria-label="Run prompt"
                      title="Run with Loki"
                    >
                      <Zap className="h-3.5 w-3.5" />
                    </button>
                    <RowActions label={`More actions for ${p.name}`}>
                      <button
                        type="button"
                        onClick={() => setScheduleId(p.id)}
                        className="ui-menu-item"
                        role="menuitem"
                      >
                        <Clock className="h-3 w-3 shrink-0" />
                        Schedule as cron job
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreating(false);
                          setEditingId(p.id);
                        }}
                        className="ui-menu-item"
                        role="menuitem"
                      >
                        <Pencil className="h-3 w-3 shrink-0" />
                        Edit
                      </button>
                      <div className="ui-menu-separator" />
                      {/* Answers in place — must not bubble to the menu's close. */}
                      <span onClick={(e) => e.stopPropagation()}>
                        <DeleteButton
                          onDelete={() => handleDelete(p.id)}
                          label="Delete prompt?"
                          triggerTitle="Delete prompt"
                          triggerLabel="Delete"
                          triggerClassName="ui-menu-item ui-menu-item-danger"
                        />
                      </span>
                    </RowActions>
                  </div>
                </header>

                <div className="flex flex-wrap gap-1.5 text-micro">
                  <span className="ui-tag">{p.scope}</span>
                  {projectName && (
                    <span className="ui-tag" title="Pinned to project">
                      {projectName}
                    </span>
                  )}
                  {/* Only shown once a prompt has actually been run. runCount is
                      schema-backed; until run-tracking writes it, this stays
                      hidden rather than displaying a placeholder 0% metric.
                      "82% · 12 runs" also made the reader guess the numerator —
                      percent of what, runs started, tokens, time? The word that
                      answers it costs seven characters, and the hover title
                      carrying it never reaches a phone. */}
                  {p.runCount > 0 && (
                    <span
                      className="ui-tag"
                      title={`${p.successCount} of ${p.runCount} runs succeeded`}
                    >
                      {`${Math.round((p.successCount / p.runCount) * 100)}% success · ${p.runCount} runs`}
                    </span>
                  )}
                  {p.tags.slice(0, 3).map((t) => (
                    <span key={t} className="ui-tag">
                      {t}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {runningPrompt && (
        <RunModal
          template={asTemplate(runningPrompt)}
          projects={projects}
          onClose={() => setRunId(null)}
        />
      )}
      {schedulingPrompt && (
        <ScheduleModal
          template={asTemplate(schedulingPrompt)}
          projects={projects}
          onClose={() => setScheduleId(null)}
        />
      )}
    </section>
  );
}

// ── Inline create / edit form ────────────────────────────────────────────────

function PromptForm({
  initial,
  projects,
  onCancel,
  onSaved,
}: {
  initial: UserPromptCard | null;
  projects: Project[];
  onCancel: () => void;
  onSaved: () => void;
}) {
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

  async function save() {
    setError(null);
    if (!name.trim() || !body.trim()) {
      setError("Name and body are both required.");
      return;
    }
    if (scope === "project" && !projectId) {
      setError("Pick a project to pin to, or switch to global.");
      return;
    }
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const body_ = {
        name: name.trim(),
        description: description.trim() || null,
        body: body.trim(),
        scope,
        projectId: scope === "project" ? projectId : null,
        tags,
      };
      const url = isEditing ? `/api/prompts/${initial!.id}` : "/api/prompts";
      const method = isEditing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body_),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? `HTTP ${res.status}`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ui-card-shell-raised p-5 space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="font-medium text-text-primary">
          {isEditing ? "Edit prompt" : "New prompt"}
        </h3>
        <button type="button" onClick={onCancel} className="ui-btn-icon" aria-label="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="space-y-2">
        <label className="ui-kicker">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Daily code review"
          className="ui-input"
        />
      </div>

      <div className="space-y-2">
        <label className="ui-kicker">
          Description <span className="text-text-tertiary">(optional)</span>
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One line about what this prompt does"
          className="ui-input"
        />
      </div>

      <div className="space-y-2">
        <label className="ui-kicker">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="The prompt the agent will receive. Use {{name}} or {{name|default}} for variables."
          rows={8}
          className="ui-input font-mono text-sm"
        />
        <p className="text-xs text-text-muted">
          Variables: <code>{`{{var_name}}`}</code> or <code>{`{{var_name|default value}}`}</code>.
          At run time the UI will prompt for each.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="ui-kicker">Scope</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "global" | "project")}
            className="ui-input"
          >
            <option value="global">Global (all my projects)</option>
            <option value="project">Pinned to one project</option>
          </select>
        </div>
        {scope === "project" && (
          <div className="space-y-2">
            <label className="ui-kicker">Project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="ui-input"
            >
              <option value="">— pick —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="ui-kicker">
          Tags <span className="text-text-tertiary">(comma-separated)</span>
        </label>
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="e.g. testing, weekly, review"
          className="ui-input"
        />
      </div>

      {error && <p className="text-xs text-status-warning">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {isEditing ? "Save changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="ui-btn-ghost">
          Cancel
        </button>
      </div>
    </div>
  );
}
