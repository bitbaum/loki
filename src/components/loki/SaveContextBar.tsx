"use client";

import { useMemo, useState } from "react";
import { BookmarkPlus, Check, Loader2 } from "lucide-react";
import { postJson, throwApiError } from "@/lib/api/fetch";
import type { LokiMessage, LokiProject } from "./types";

/**
 * One-tap "save what we just figured out into the project's context". After Loki
 * asks its context-gap questions and you answer, this sends the exchange to
 * /api/projects/[id]/brief, which extracts a structured profile (mission, stack,
 * problem, definition-of-done…) and writes it to the project — so the context you
 * just typed actually powers future development instead of evaporating in chat.
 *
 * Target defaults to the project Loki named in the conversation (else the one
 * selected, else the first), and is changeable in one click.
 */
export function SaveContextBar({
  projects,
  messages,
  selectedProject,
  defaultOpen = false,
}: {
  projects: LokiProject[];
  messages: LokiMessage[];
  selectedProject: string | null;
  /** Opened from the phone's conversation menu: skip the one-line trigger. */
  defaultOpen?: boolean;
}) {
  const savable = useMemo(() => projects.filter((p) => p.entityProjectId), [projects]);
  const [open, setOpen] = useState(defaultOpen);

  // The project this exchange is about: named by Loki in the transcript, else the
  // selected one, else the first savable project.
  const suggested = useMemo(() => {
    const assistantText = messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content.toLowerCase())
      .join(" ");
    const named =
      savable.find((p) => assistantText.includes(`**${p.name.toLowerCase()}**`)) ??
      savable.find((p) => assistantText.includes(p.name.toLowerCase()));
    return (
      named?.name ??
      (selectedProject && savable.some((p) => p.name === selectedProject)
        ? selectedProject
        : savable[0]?.name) ??
      null
    );
  }, [messages, savable, selectedProject]);

  const [target, setTarget] = useState<string | null>(suggested);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  // Keep the picker aligned with what the conversation is about until the user
  // overrides it (once they touch the select, `touched` freezes their choice).
  const [touched, setTouched] = useState(false);
  const effectiveTarget = touched ? target : suggested;

  const transcript = useMemo(
    () =>
      messages.map((m) => `${m.role === "user" ? "Operator" : "Loki"}: ${m.content}`).join("\n\n"),
    [messages],
  );

  if (savable.length === 0 || messages.length === 0) return null;

  async function save() {
    const proj = savable.find((p) => p.name === effectiveTarget);
    if (!proj?.entityProjectId || transcript.trim().length < 10) return;
    setState("saving");
    setErr(null);
    try {
      const res = await postJson(`/api/projects/${proj.entityProjectId}/brief`, {
        text: transcript,
      });
      if (!res.ok) await throwApiError(res, "Could not save context");
      setState("saved");
    } catch (e) {
      setState("error");
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  // Collapsed by default. This bar used to render in full after EVERY message,
  // permanently occupying the strip between the transcript and the composer —
  // on a laptop it clipped the tail of the answer the operator was reading.
  // Saving to a project is an occasional deliberate act, not a per-turn one, so
  // it earns a one-line trigger and nothing more until asked for.
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ui-loki-save-trigger">
        <BookmarkPlus className="h-3.5 w-3.5" />
        {state === "saved"
          ? "Saved to project context"
          : "Save this exchange to a project\u2019s context"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface-base px-3 py-2 text-sm">
      <BookmarkPlus className="h-4 w-4 shrink-0 text-text-tertiary" />
      <span className="text-text-secondary">Save this into</span>
      <select
        value={effectiveTarget ?? ""}
        onChange={(e) => {
          setTouched(true);
          setTarget(e.target.value);
          setState("idle");
        }}
        className="ui-input-tight"
        aria-label="Project to save context into"
      >
        {savable.map((p) => (
          <option key={p.id} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="text-text-secondary">&rsquo;s context</span>
      <button
        type="button"
        onClick={() => void save()}
        disabled={state === "saving" || state === "saved"}
        className={state === "saved" ? "ui-btn-secondary gap-1.5" : "ui-btn-save gap-1.5"}
      >
        {state === "saving" ? (
          <Loader2 className="ui-spinner-xs" />
        ) : state === "saved" ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <BookmarkPlus className="h-3.5 w-3.5" />
        )}
        {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "Save"}
      </button>
      {state === "saved" && (
        <span className="text-xs text-text-tertiary">Loki will use it going forward.</span>
      )}
      {err && <span className="ui-error-xs">{err}</span>}
    </div>
  );
}
