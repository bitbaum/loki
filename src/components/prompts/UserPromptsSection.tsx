"use client";

// User-owned prompts section on /prompts. Renders ABOVE the Loki
// defaults so the user's own prompts are first-class — they grow over
// time as the user works and become more relevant than the seed catalog.
//
// v2.1a (this file): list + create. v2.1b adds edit + delete on each card.
// v2.2 adds the variables modal for {{name}} placeholders at run time.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X, Pencil, Zap, Clock, Copy } from "lucide-react";
import type { Project } from "./types";
import { RunModal } from "./RunModal";
import { ScheduleModal } from "./ScheduleModal";
import { SAVED_PROMPTS_TITLE } from "@/config/control-labels";
import { RowActions } from "@/components/ui/row-actions";
import { DeleteButton } from "@/components/ui/delete-button";
import { timeAgo } from "@/lib/dates";
import { collapseDuplicates, dupeKey } from "@/lib/prompt-duplicates";
import {
  SAVED_PROMPT_SEARCH_SPEC,
  savedPromptAsTemplate,
  searchPrompts,
} from "@/lib/prompt-search";

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
  /** Yours, rather than an org peer's shared prompt. Only your own copies can
   *  be removed. Absent = yours. */
  own?: boolean;
}

/** Where a save landed: a new prompt, or the identical one already saved. */
type Saved = { id: string; existing: boolean };

export function UserPromptsSection({
  prompts,
  projects,
  query = "",
  timeZone,
}: {
  prompts: UserPromptCard[];
  projects: Project[];
  /** The page's search box: it finds your own prompts too, best match first. */
  query?: string;
  /** The clock a scheduled prompt keeps. */
  timeZone: string;
}) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  // Said above the form when a Create found the same prompt already saved.
  const [notice, setNotice] = useState<string | null>(null);
  const [removingCopiesOf, setRemovingCopiesOf] = useState<string | null>(null);
  const [copiesError, setCopiesError] = useState<string | null>(null);
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

  /**
   * The explicit clean-up for identical copies: the card says how many there
   * are, and this one tap removes them — never on its own, never silently.
   * The newest stays; the rest are soft-deleted like any Delete.
   */
  async function removeExtraCopies(id: string) {
    setRemovingCopiesOf(id);
    setCopiesError(null);
    try {
      const res = await fetch(`/api/prompts/${id}/copies`, { method: "DELETE" });
      if (!res.ok) {
        setCopiesError("Could not remove the copies — try again.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setCopiesError("Could not remove the copies — try again.");
    } finally {
      setRemovingCopiesOf(null);
    }
  }

  const editingPrompt = editingId ? (prompts.find((p) => p.id === editingId) ?? null) : null;
  const runningPrompt = runId ? (prompts.find((p) => p.id === runId) ?? null) : null;
  const schedulingPrompt = scheduleId ? (prompts.find((p) => p.id === scheduleId) ?? null) : null;

  const { visible: allVisible } = collapseDuplicates(prompts);
  // Your own rows per distinct prompt — what "Remove extra copies" can act on.
  const ownRows = new Map<string, UserPromptCard[]>();
  for (const p of prompts) {
    if (p.own === false) continue;
    const key = dupeKey(p);
    ownRows.set(key, [...(ownRows.get(key) ?? []), p]);
  }
  const visiblePrompts = query.trim()
    ? searchPrompts(allVisible, SAVED_PROMPT_SEARCH_SPEC, (p) => p.body, query).map((h) => h.item)
    : allVisible;

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
            {query.trim() && allVisible.length > 0
              ? `${visiblePrompts.length} of ${allVisible.length} saved match · best match first`
              : visiblePrompts.length === 0
                ? "Reusable templates you write — separate from what you send from Home."
                : `${visiblePrompts.length} saved · most-recent first`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setNotice(null);
            setIsCreating(true);
          }}
          className="ui-btn-primary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm"
        >
          <Plus className="h-3.5 w-3.5" />
          New prompt
        </button>
      </header>

      {notice && (
        <p className="text-sm text-text-secondary" role="status">
          {notice}
        </p>
      )}
      {(isCreating || editingPrompt) && (
        <PromptForm
          // A fresh form per prompt, so opening the one already saved shows
          // its words rather than the ones just typed.
          key={editingPrompt?.id ?? "new"}
          initial={editingPrompt}
          projects={projects}
          onCancel={() => {
            setIsCreating(false);
            setEditingId(null);
            setNotice(null);
          }}
          onSaved={(saved) => {
            setIsCreating(false);
            if (saved.existing) {
              // Creating the same name + words again opens the one you have
              // instead of saving a second copy.
              setEditingId(saved.id);
              setNotice(
                "You already have this prompt saved — here it is. Nothing new was created.",
              );
            } else {
              setEditingId(null);
              setNotice(null);
            }
            startTransition(() => router.refresh());
          }}
        />
      )}
      {copiesError && <p className="ui-error-xs">{copiesError}</p>}

      {/* No full empty-state card here: the header already says "Build your own
          library" with the New prompt button, and the forkable Loki
          defaults render immediately below. A padded card repeating that was a
          dead band — costly on mobile. One muted line keeps the fork pointer. */}
      {visiblePrompts.length === 0 && !isCreating && (
        <p className="text-xs text-text-muted">
          {query.trim() && allVisible.length > 0
            ? "None of your own prompts match — Loki's below may."
            : "…or fork a Loki default below to make it your own."}
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
              ? (projects.find((pr) => pr.id === p.projectId)?.title ?? "(deleted project)")
              : null;
            const mine = ownRows.get(dupeKey(p)) ?? [];
            const extraCopies = Math.max(0, mine.length - 1);
            // Same name, different words: two real prompts. Say so, or two
            // "Next Best Step" cards look like the same one twice.
            const sameName = allVisible.filter((v) => v.name === p.name).length;
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
                      {sameName > 1
                        ? ` · ${sameName} versions with this name, worded differently`
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

                {/* The list shows one card per distinct prompt. Extra identical
                    rows behind it are named with their number and removed only
                    by this tap. */}
                {extraCopies > 0 && (
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <span className="min-w-0">Saved {mine.length} times, word for word.</span>
                    <button
                      type="button"
                      onClick={() => removeExtraCopies(mine[0]!.id)}
                      disabled={removingCopiesOf !== null}
                      className="ui-btn-ghost min-h-11 shrink-0 text-xs"
                    >
                      {removingCopiesOf === mine[0]!.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Remove {extraCopies} extra {extraCopies === 1 ? "copy" : "copies"}
                    </button>
                  </div>
                )}

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
          template={savedPromptAsTemplate(runningPrompt)}
          projects={projects}
          pinnedProjectId={runningPrompt.projectId}
          onClose={() => setRunId(null)}
        />
      )}
      {schedulingPrompt && (
        <ScheduleModal
          template={savedPromptAsTemplate(schedulingPrompt)}
          projects={projects}
          timeZone={timeZone}
          pinnedProjectId={schedulingPrompt.projectId}
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
  onSaved: (saved: Saved) => void;
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

  // What Create is still waiting for, in words — said beside the button, which
  // stays pressable only when nothing is. An empty Create never reaches the API
  // (and the API refuses one anyway: CreatePromptBody).
  const missing = [
    ...(!name.trim() ? ["a name"] : []),
    ...(!body.trim() ? ["the prompt"] : []),
    ...(scope === "project" && !projectId ? ["a project to pin it to"] : []),
  ];
  const missingSentence =
    missing.length > 0
      ? `Add ${missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0]} to ${isEditing ? "save" : "create"} it.`
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
      const b = (await res.json().catch(() => ({}))) as {
        error?: string;
        existing?: boolean;
        prompt?: { id?: string };
      };
      if (!res.ok) {
        setError(b.error ?? `Could not save (HTTP ${res.status}) — try again.`);
        return;
      }
      onSaved({ id: b.prompt?.id ?? initial?.id ?? "", existing: !!b.existing });
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
        <label className="ui-kicker">Prompt</label>
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
                  {p.title}
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
          disabled={saving || !!missingSentence}
          className="ui-btn-primary min-h-11 shrink-0"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {isEditing ? "Save changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="ui-btn-ghost min-h-11 shrink-0">
          Cancel
        </button>
        {missingSentence && (
          <p className="min-w-0 text-xs text-text-secondary">{missingSentence}</p>
        )}
      </div>
    </div>
  );
}
