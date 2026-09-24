"use client";

import { useRef, useState } from "react";
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
}) {
  const [text, setText] = useState(defaultText);
  const [model, setModel] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scopedProject = selectedProjects.length === 1 ? selectedProjects[0] : null;
  const allChips = composerChips({ projectCount, selectedProjects, selectedGoal });
  const chips = showStarters || selectedProjects.length > 0 ? allChips : [];

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
      <div className="ui-loki-suggest-row">
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

  const scopeRow = showScopeRow ? (
    <div className="ui-loki-composer-scope-row">
      {offersProjectButton && (
        <button type="button" className="ui-btn-chip" onClick={onOpenProjects}>
          <FolderKanban className="h-3.5 w-3.5" /> Project
        </button>
      )}
      {selectedProjects.map((project) => (
        <span key={project} className="ui-loki-scope-pill">
          <span className="truncate">{project}</span>
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
          className="ui-loki-scope-add"
          onClick={onOpenProjects}
          aria-label="Change project scope"
          title="Change project scope"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
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
      modelPicker
      above={suggestions}
      header={scopeRow}
      trailing={
        selectedProjects.length > 0 ? <ExecutorHonestyChip honesty={dispatchHonesty} /> : null
      }
      onSend={(outgoing, choice, attachments) => onSend(outgoing, choice, attachments)}
    />
  );
}
