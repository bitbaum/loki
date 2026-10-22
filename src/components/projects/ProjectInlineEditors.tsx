"use client";

import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { StatusBadge } from "./project-badges";
import { useInlineEdit } from "@/hooks/use-inline-edit";
import { cn } from "@/lib/utils";

/** Inline-editable description (button ↔ textarea + Save/Cancel). */
export function DescriptionEditor({
  value,
  editable = true,
  onSave,
  size = "compact",
}: {
  value: string | null;
  editable?: boolean;
  onSave: (next: string) => Promise<void>;
  size?: "compact" | "lead" | "full";
}) {
  const ie = useInlineEdit<string>("");

  const [saveError, setSaveError] = useState<string | null>(null);
  const commit = async () => {
    setSaveError(null);
    if (!(await ie.commit(() => onSave(ie.draft.trim())))) {
      setSaveError("Could not save. Your draft is still here; try again.");
    }
  };

  if (!editable) {
    return value ? (
      <p
        className={cn(
          "mt-0.5 w-full cursor-default text-left leading-relaxed text-text-secondary",
          size === "lead"
            ? "line-clamp-3 text-sm sm:text-base"
            : size === "full"
              ? "text-sm sm:text-base"
              : "ui-link-subtle",
        )}
      >
        {value}
      </p>
    ) : null;
  }

  if (ie.editing) {
    return (
      <div className="mt-1.5 space-y-1.5">
        <textarea
          value={ie.draft}
          onChange={(e) => ie.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") ie.cancel();
            if (e.key === "Enter" && e.metaKey) commit();
          }}
          autoFocus
          rows={size === "full" ? 6 : 2}
          placeholder="Add a description…"
          className={cn(
            "ui-input-inline w-full resize-none px-2 py-1.5 text-text-primary placeholder:text-text-muted",
            size !== "compact" ? "text-sm sm:text-base" : "text-xs",
          )}
        />
        <div className="flex items-center gap-2">
          <button onClick={commit} disabled={ie.saving} className="ui-btn-save">
            {ie.saving ? <Loader2 className="ui-spinner-xs" /> : "Save"}
          </button>
          <button onClick={ie.cancel} className="ui-btn-text-cancel">
            Cancel
          </button>
        </div>
        {saveError && (
          <p className="ui-error text-sm" role="alert">
            {saveError}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setSaveError(null);
        ie.start(value ?? "");
      }}
      className={cn(
        "group/desc mt-0.5 flex min-h-11 w-full items-center gap-1.5 text-left leading-relaxed text-text-secondary",
        size !== "compact" ? "text-sm sm:text-base" : "ui-link-subtle",
      )}
      title="Edit description"
    >
      <span className="flex-1">
        {value ?? <span className="italic text-text-muted">Add a description…</span>}
      </span>
      <Pencil className="h-3 w-3 shrink-0 mt-0.5 text-text-muted sm:opacity-0 sm:group-hover/desc:opacity-100 transition-opacity" />
    </button>
  );
}

/** Inline-editable status pill. */
export function StatusEditor({
  value,
  editable = true,
  onSave,
}: {
  value: string | null;
  editable?: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const ie = useInlineEdit<string>("");

  const commit = () => {
    const trimmed = ie.draft.trim();
    if (!trimmed) {
      ie.cancel();
      return;
    }
    ie.commit(() => onSave(trimmed));
  };

  if (!editable) {
    return value ? <StatusBadge value={value} /> : null;
  }

  if (ie.editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          value={ie.draft}
          onChange={(e) => ie.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") ie.cancel();
          }}
          onBlur={commit}
          autoFocus
          placeholder="planning / development / production"
          className="ui-input-inline ui-tap w-36 border-border-strong px-2 py-2 text-base text-text-primary placeholder:text-text-muted sm:py-0.5 sm:text-xs"
        />
        {ie.saving && <Loader2 className="ui-spinner-xs text-text-muted shrink-0" />}
      </div>
    );
  }

  return (
    // "Stage", not "status": the health breakdown two chips away already calls
    // this field "Stage declared", and the app spends "status" on CI, run and
    // agent status. Two words for one field, side by side, is the confusion.
    // The attr key stays `status` — this is vocabulary, not schema.
    <button
      onClick={() => ie.start(value ?? "")}
      title="Edit lifecycle stage"
      aria-label={value ? `Stage: ${value} — edit` : "Set the lifecycle stage"}
      className="flex min-h-11 items-center"
    >
      {value ? <StatusBadge value={value} /> : <span className="ui-add-chip">+ stage</span>}
    </button>
  );
}

// MaturityEditor (the 1–10 slider) is retired: the health score is now derived
// from named checks (src/lib/project-health.ts) instead of hand-typed.
