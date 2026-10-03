"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FolderKanban, Plus, X } from "lucide-react";
import {
  composerChips,
  fillSuggestedAction,
  type LokiComposerChip,
} from "@/config/loki-suggested-actions";
import { ExecutorHonestyChip } from "@/components/executor/ExecutorHonestyChip";
import type { ExecutorHonestyLabel } from "@/lib/executor-honesty";
import { Composer } from "@/components/composer/Composer";
import { readLokiDraft, writeLokiDraft } from "@/lib/loki/draft";
import type { Attachment, LokiProject, ModelChoice } from "./types";

const IMAGE_ONLY_DEFAULT = "What's wrong here and what should we change?";

/**
 * Loki chat's use of THE composer (components/composer/Composer.tsx).
 *
 * What is Loki-chat-specific lives here and only here: the suggestion chips an
 * empty thread offers, and the project scope the next message is aimed at.
 * Text, attachments, voice, the model picker and Send/Stop are the shared
 * composer's — the same ones the terminal's Ask / Inject rail now uses.
 *
 * ── What changed, and why ────────────────────────────────────────────────────
 * The composer used to stack up to FIVE rows — scope pills, suggestion chips,
 * the textarea, staged attachments, then a tools row — so on a phone the input
 * you came to use was a band in the middle of its own furniture. There is the
 * text, and one row of controls under it. Everything else appears only when it
 * has something to say.
 */
export function LokiComposer({
  disabled,
  sending,
  onSend,
  onStop,
  defaultText = "",
  selectedProjects = [],
  projectCount = 0,
  selectedGoal = null,
  onRemoveProject,
  onOpenProjects,
  dispatchHonesty = null,
  showStarters = true,
  draftKey,
  queue = false,
}: {
  disabled: boolean;
  sending: boolean;
  onSend: (
    text: string,
    choice: ModelChoice,
    attachments: Attachment[],
    opts?: { chatOnly?: boolean },
  ) => void;
  /** Cancel the turn in flight. The send button becomes this while one runs. */
  onStop: () => void;
  defaultText?: string;
  selectedProjects?: string[];
  projectCount?: number;
  selectedGoal?: LokiProject["topGoal"];
  onRemoveProject?: (name: string) => void;
  onOpenProjects?: () => void;
  dispatchHonesty?: ExecutorHonestyLabel | null;
  /** Openers belong on an empty thread. Mid-conversation they re-offer a
   *  decision already made, and on a phone they ate a third of the transcript. */
  showStarters?: boolean;
  /** Where the draft is mirrored so a discarded tab gives it back (see
   *  lib/loki/draft.ts). Omit and the draft lives in memory only. */
  draftKey?: string;
  /** Take the next message while a turn runs (the workspace queues it). */
  queue?: boolean;
}) {
  const [text, setTextState] = useState(defaultText);
  // Restore once, on the client, after the server-rendered empty box: reading
  // storage in the initializer would hydrate a different value than the
  // server sent. A prefill (defaultText) is a deliberate newer intent and
  // wins over whatever was left behind.
  useEffect(() => {
    if (!draftKey || defaultText) return;
    const saved = readLokiDraft(draftKey);
    if (saved) setTextState(saved); // eslint-disable-line react-hooks/set-state-in-effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  const setText = (next: string) => {
    setTextState(next);
    if (draftKey) writeLokiDraft(draftKey, next);
  };
  const [model, setModel] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scopedProject = selectedProjects.length === 1 ? selectedProjects[0] : null;
  const allChips = composerChips({ projectCount, selectedProjects, selectedGoal });
  // Starters belong on an empty thread. Mid-conversation the project chips
  // (Move forward / Review / Fix tests) stay one tap away on wider screens, but
  // on a phone they were a full row taken from the transcript every turn.
  const chips = showStarters || selectedProjects.length > 0 ? allChips : [];
  const chipsPhoneHidden = !showStarters;

  const runChip = (chip: LokiComposerChip) => {
    if (disabled || sending) return;
    if (chip.kind === "open_projects") return onOpenProjects?.();
    if (chip.kind === "href") return;
    const prompt = fillSuggestedAction(chip.template ?? "", scopedProject);
    if (!prompt) return;
    if (chip.kind === "prefill") {
      setText(prompt);
      textareaRef.current?.focus();
      return;
    }
    onSend(prompt, model ? { model } : {}, [], chip.chatOnly ? { chatOnly: true } : undefined);
  };

  const placeholder = scopedProject
    ? `Ask, or send work to ${scopedProject}…`
    : selectedProjects.length > 1
      ? `Ask, or send work to ${selectedProjects.length} projects…`
      : projectCount === 0
        ? "Name a new project, or ask anything…"
        : "Ask anything, or send work to a project…";

  // Only when it has something in it. The old scope row reserved 28px of a
  // phone screen to display nothing.
  const offersProjectButton =
    selectedProjects.length === 0 &&
    projectCount > 0 &&
    Boolean(onOpenProjects) &&
    (Boolean(text.trim()) || !chips.some((c) => c.kind === "open_projects"));
  const showScopeRow = selectedProjects.length > 0 || offersProjectButton;

  const suggestions =
    !text.trim() && chips.length > 0 ? (
      <div
        className={chipsPhoneHidden ? "ui-loki-suggest-row max-md:hidden" : "ui-loki-suggest-row"}
      >
        {chips.map((chip) => {
          const title =
            chip.kind === "href"
              ? chip.label
              : chip.kind === "open_projects"
                ? "Choose a project"
                : fillSuggestedAction(chip.template ?? "", scopedProject);
          return chip.kind === "href" && chip.href ? (
            <Link key={chip.id} href={chip.href} className="ui-loki-suggest-chip" title={title}>
              {chip.label}
            </Link>
          ) : (
            <button
              key={chip.id}
              type="button"
              className="ui-loki-suggest-chip"
              disabled={disabled || sending}
              onClick={() => runChip(chip)}
              title={title}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    ) : null;

  // Scope sits INLINE with attach / mic / model, not in a header row of its
  // own: on a phone that row was a whole line spent on one pill and a "+".
  // Tapping the pill opens the picker; the "+" is kept only from md up.
  const scope = showScopeRow ? (
    <>
      {offersProjectButton && (
        <button type="button" className="ui-loki-scope-btn" onClick={onOpenProjects}>
          <FolderKanban className="h-4 w-4" aria-hidden /> Project
        </button>
      )}
      {selectedProjects.map((project) => (
        <span key={project} className="ui-loki-scope-pill">
          {onOpenProjects ? (
            <button
              type="button"
              className="truncate"
              onClick={onOpenProjects}
              title="Change project scope"
            >
              {project}
            </button>
          ) : (
            <span className="truncate">{project}</span>
          )}
          {onRemoveProject && (
            <button
              type="button"
              className="ui-loki-scope-remove"
              onClick={() => onRemoveProject(project)}
              aria-label={`Remove ${project}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {selectedProjects.length > 0 && onOpenProjects && (
        <button
          type="button"
          className="ui-loki-scope-add max-md:hidden"
          onClick={onOpenProjects}
          aria-label="Change project scope"
          title="Change project scope"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </>
  ) : null;

  return (
    <Composer
      value={text}
      onValueChange={setText}
      model={model}
      onModelChange={setModel}
      inputRef={textareaRef}
      placeholder={placeholder}
      disabled={disabled}
      sending={sending}
      onStop={onStop}
      attachmentOnlyText={IMAGE_ONLY_DEFAULT}
      queue={queue}
      modelPicker
      above={suggestions}
      tools={scope}
      trailing={
        selectedProjects.length > 0 ? (
          <ExecutorHonestyChip honesty={dispatchHonesty} compact />
        ) : null
      }
      onSend={(outgoing, choice, attachments) => onSend(outgoing, choice, attachments)}
    />
  );
}
