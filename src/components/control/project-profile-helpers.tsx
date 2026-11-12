"use client";

import { useState, useRef, useCallback } from "react";
import { Loader2, StickyNote } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";
import type { UserProject } from "@/db/schema/user-projects";
import { CollapsibleSection } from "./project-profile-sections";

export function NotesSection({
  projectId,
  project,
}: {
  projectId: string;
  project: UserProject | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const value = draft ?? project?.notes ?? "";

  const persist = useCallback(
    async (text: string) => {
      setSaving(true);
      try {
        await patchJson(`/api/user-projects/${projectId}`, { notes: text || undefined });
      } catch {
        /* ignore */
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  const handleChange = (text: string) => {
    setDraft(text);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(text), 900);
  };

  const handleBlur = () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (draft !== null) persist(draft);
  };

  if (!project) return null;

  return (
    <CollapsibleSection
      title="Notes"
      icon={<StickyNote className="h-3.5 w-3.5 text-text-muted" />}
      badge={
        project.notes ? <span className="h-1.5 w-1.5 rounded-full bg-accent-text/50" /> : undefined
      }
      trailing={saving ? <Loader2 className="h-3 w-3 animate-spin text-text-muted" /> : undefined}
    >
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="Free-form notes, context, or reminders for this project…"
        rows={5}
        className="w-full resize-y rounded-xl border border-border-subtle bg-surface-base px-3.5 py-2.5 text-sm leading-relaxed text-text-primary placeholder:text-text-muted focus:border-accent-primary/50 focus:outline-none focus:ring-1 focus:ring-accent-primary/20"
      />
    </CollapsibleSection>
  );
}
