"use client";

import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import {
  CATEGORY_META,
  FEATURED_PROJECT_PROMPTS,
  substituteProjectName,
} from "@/config/prompt-library";
import { PROMPT_LIBRARY_TITLE } from "@/config/control-labels";
import { cn } from "@/lib/utils";

export function ProjectPromptLibrary({
  projectName,
  open,
  onOpenChange,
  onSelect,
  compact = false,
}: {
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (prompt: string) => void;
  compact?: boolean;
}) {
  if (FEATURED_PROJECT_PROMPTS.length === 0) return null;

  return (
    <div className="border-t border-border-subtle pt-2.5">
      <button
        onClick={() => onOpenChange(!open)}
        title="Open reusable prompt templates for common project work."
        className="ui-tap flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs text-text-muted transition-colors hover:text-text-secondary"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <BookOpen className="h-3 w-3" />
          {PROMPT_LIBRARY_TITLE}
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className={cn("mt-2 grid gap-1.5", compact ? "grid-cols-1" : "grid-cols-2")}>
          {FEATURED_PROJECT_PROMPTS.map((template) => {
            const meta = CATEGORY_META[template.category];
            const text = substituteProjectName(template.template, projectName);
            return (
              <button
                key={template.id}
                onClick={() => onSelect(text)}
                title={template.description}
                className="group flex min-h-24 flex-col gap-1 rounded-xl border border-border-subtle bg-surface-base px-3 py-2.5 text-left transition-colors hover:border-border-default hover:bg-surface-raised"
              >
                <span className="text-xs font-semibold leading-tight text-text-primary">
                  {template.name}
                </span>
                <span className="line-clamp-2 text-micro leading-snug text-text-muted">
                  {template.description}
                </span>
                <span
                  className={cn(
                    "mt-auto self-start rounded-full border px-1.5 py-0.5 text-micro font-medium",
                    "ui-tag-neutral",
                  )}
                >
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
