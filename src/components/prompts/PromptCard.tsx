"use client";

// Unified prompt card — the single card format for Loki default prompts.
// Replaces the old FeaturedCard (Quick Access grid) + PromptRow (category rows)
// split: one library, one card, rendered in one responsive grid. Featured
// prompts are marked with a star and sorted first rather than duplicated into a
// separate section.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Clock,
  Globe,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  Check,
  Copy,
  Loader2,
  Star,
} from "lucide-react";
import { usePromptModals } from "./use-prompt-modals";
import { useForkPrompt } from "./use-fork-prompt";
import { CATEGORY_META, type PromptTemplate } from "@/config/prompt-library";
import type { Project } from "./types";
import { haptic } from "@/lib/haptics";

export function PromptCard({
  template,
  projects,
}: {
  template: PromptTemplate;
  projects: Project[];
}) {
  const { openRun, openSchedule, modals } = usePromptModals(template, projects);
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { fork, state } = useForkPrompt(template, () => startTransition(() => router.refresh()));
  const meta = CATEGORY_META[template.category];

  return (
    <>
      {/* A row, not a poster. 44 defaults each with a badge row, a large title,
          an unclamped paragraph and a full-width Run button made /prompts
          11,000px on a phone (2026-10-01). Same facts: the category chip and
          star lead the title, scope sits in one quiet line, Run is one button. */}
      <div className="ui-card-shell-raised ui-panel-interactive group flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-1.5 text-base font-semibold leading-snug text-text-primary">
              <span className="min-w-0">{template.name}</span>
              {template.featured && (
                <Star
                  className="h-3.5 w-3.5 shrink-0 fill-status-warning/80 text-status-warning/80"
                  aria-label="Featured"
                />
              )}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-text-secondary">
              {template.description}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
              <span className={`ui-chip ${meta.color}`}>{meta.label}</span>
              <span className="inline-flex items-center gap-1">
                {template.scope === "global" ? (
                  <Globe className="h-3 w-3" aria-hidden />
                ) : (
                  <FolderOpen className="h-3 w-3" aria-hidden />
                )}
                {template.scope === "global" ? "any project" : "one project"}
              </span>
              {template.suggestedSchedule && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden /> can run on a schedule
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              haptic();
              openRun();
            }}
            className="ui-btn-secondary inline-flex min-h-11 items-center gap-1.5 text-sm"
          >
            <Zap className="h-4 w-4" /> Run
          </button>
          <span className="flex-1" aria-hidden />
          <button
            onClick={() => setExpanded(!expanded)}
            className="ui-btn-overlay p-3"
            title="Preview prompt"
            aria-label="Preview prompt"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={fork}
            disabled={state === "forking" || isPending}
            className="ui-btn-overlay p-3 disabled:opacity-40"
            title="Fork into your own prompts"
            aria-label="Fork prompt"
          >
            {state === "forking" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : state === "done" ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
          {template.suggestedSchedule && (
            <button
              onClick={openSchedule}
              className="ui-btn-overlay p-3"
              title="Schedule as cron job"
              aria-label="Schedule prompt"
            >
              <Clock className="h-4 w-4" />
            </button>
          )}
        </div>

        {expanded && <pre className="ui-code-surface">{template.template}</pre>}
      </div>

      {modals}
    </>
  );
}
