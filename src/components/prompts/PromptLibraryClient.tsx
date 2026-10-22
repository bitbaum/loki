"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, CalendarClock, Search } from "lucide-react";
import {
  GROUP_META,
  PROMPT_GROUPS,
  groupForCategory,
  type PromptTemplate,
} from "@/config/prompt-library";
import { PageLayout } from "@/components/ui/page-layout";
import { PageActionButton } from "@/components/ui/page-action";
import { Section } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow, ListSearch } from "@/components/ui/list-row";
import { RowActions } from "@/components/ui/row-actions";
import { NAV } from "@/config/navigation";
import { PROMPT_SEARCH_SPEC, savedPromptAsTemplate, searchPrompts } from "@/lib/prompt-search";
import { RunModal } from "./RunModal";
import { ScheduleModal } from "./ScheduleModal";
import { PromptForm } from "./PromptForm";
import { UserPromptsSection, type UserPromptCard } from "./UserPromptsSection";
import { useForkPrompt } from "./use-fork-prompt";
import type { Project } from "./types";

/** The prompt a sheet is open for, and the project it starts on. */
type Target = { template: PromptTemplate; pinnedProjectId?: string | null };

/**
 * /prompts — your prompts and Loki's, as rows. Rebuilt to the design reset
 * (docs/development/design-reset-2026-10.md) from the owner's phone, where
 * each of 44 prompts was a card with a badge, a scope line, "can run on a
 * schedule", a Run button and three square icon buttons.
 *
 * Now: the page's one action is New prompt (the round + in the top bar); the
 * search is the list's first row; each prompt is a ListRow — its name, one
 * line, "Run" — and tapping it opens the Run sheet with ONE Run button.
 * Loki's library is grouped under plain headings instead of two filter rows
 * (a scope switch and a strip of category chips) that each narrowed a
 * different thing.
 */
export function PromptLibraryClient({
  templates,
  projects,
  userPrompts = [],
  timeZone,
}: {
  templates: PromptTemplate[];
  projects: Project[];
  userPrompts?: UserPromptCard[];
  /** The person's Loki time zone — the clock repeated prompts keep. */
  timeZone: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState<Target | null>(null);
  const [scheduling, setScheduling] = useState<Target | null>(null);
  // The form: null closed, "new", or the saved prompt being edited.
  const [editing, setEditing] = useState<UserPromptCard | "new" | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const query = search.trim();
  const libraryMatches = query
    ? searchPrompts(templates, PROMPT_SEARCH_SPEC, (t) => t.template, query).map((h) => h.item)
    : templates;
  const savedTarget = (p: UserPromptCard): Target => ({
    template: savedPromptAsTemplate(p),
    pinnedProjectId: p.projectId,
  });

  const libraryRow = (t: PromptTemplate) => (
    <LibraryRow
      key={t.id}
      template={t}
      onRun={() => setRunning({ template: t })}
      onSchedule={() => setScheduling({ template: t })}
      onSaved={() => startTransition(() => router.refresh())}
    />
  );

  return (
    <PageLayout
      title={NAV.prompts.label}
      maxWidth="max-w-2xl"
      action={
        <PageActionButton
          label="New prompt"
          onClick={() => {
            setFormNotice(null);
            setEditing("new");
          }}
        />
      }
    >
      <div>
        <ListSearch value={search} onChange={setSearch} placeholder="Search prompts" />
      </div>

      <UserPromptsSection
        prompts={userPrompts}
        query={search}
        onRun={(p) => setRunning(savedTarget(p))}
        onSchedule={(p) => setScheduling(savedTarget(p))}
        onEdit={(p) => {
          setFormNotice(null);
          setEditing(p);
        }}
      />

      {query ? (
        libraryMatches.length > 0 ? (
          <Section title="Loki's prompts">
            <List aria-label="Loki's prompts">{libraryMatches.map(libraryRow)}</List>
          </Section>
        ) : (
          <EmptyState
            icon={Search}
            title={`No prompt matches “${query}”`}
            size="sm"
            action={
              <button type="button" onClick={() => setSearch("")} className="ui-btn-secondary">
                Show every prompt
              </button>
            }
          />
        )
      ) : (
        PROMPT_GROUPS.map((group) => {
          const inGroup = templates.filter((t) => groupForCategory(t.category) === group);
          if (inGroup.length === 0) return null;
          return (
            <Section key={group} title={GROUP_META[group].label}>
              <List aria-label={GROUP_META[group].label}>{inGroup.map(libraryRow)}</List>
            </Section>
          );
        })
      )}

      {running && (
        <RunModal
          template={running.template}
          projects={projects}
          pinnedProjectId={running.pinnedProjectId}
          onClose={() => setRunning(null)}
        />
      )}
      {scheduling && (
        <ScheduleModal
          template={scheduling.template}
          projects={projects}
          timeZone={timeZone}
          pinnedProjectId={scheduling.pinnedProjectId}
          onClose={() => setScheduling(null)}
        />
      )}
      {editing && (
        <PromptForm
          // A fresh form per prompt, so opening the one already saved shows
          // its words rather than the ones just typed.
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          projects={projects}
          notice={formNotice}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            startTransition(() => router.refresh());
            const same = saved.existing ? userPrompts.find((p) => p.id === saved.id) : null;
            if (same) {
              // Saving the same name + words again opens the one you have
              // instead of keeping a second copy.
              setFormNotice("You already have this prompt. Here it is; nothing new was saved.");
              setEditing(same);
            } else {
              setEditing(null);
            }
          }}
        />
      )}
    </PageLayout>
  );
}

/** One of Loki's prompts: its name, one line, "Run". The rest is its menu. */
function LibraryRow({
  template,
  onRun,
  onSchedule,
  onSaved,
}: {
  template: PromptTemplate;
  onRun: () => void;
  onSchedule: () => void;
  onSaved: () => void;
}) {
  const { fork, state } = useForkPrompt(template, onSaved);
  // Saving a copy answers on the row itself, for a moment: the one line says
  // where it went.
  const line =
    state === "forking"
      ? "Saving a copy…"
      : state === "done"
        ? "Saved to your prompts, above"
        : state === "exists"
          ? "Already in your prompts, above"
          : state === "error"
            ? "Could not save a copy. Try again."
            : template.description;
  return (
    <ListRow
      onClick={onRun}
      title={template.name}
      secondary={line}
      trailing={<span className="ui-prompt-run-cue">Run</span>}
      menu={
        <RowActions label={`More for ${template.name}`}>
          <button
            type="button"
            onClick={() => void fork()}
            className="ui-menu-item"
            role="menuitem"
          >
            <BookmarkPlus className="h-4 w-4 shrink-0" />
            Save a copy to edit
          </button>
          {template.suggestedSchedule && (
            <button type="button" onClick={onSchedule} className="ui-menu-item" role="menuitem">
              <CalendarClock className="h-4 w-4 shrink-0" />
              Repeat on a schedule
            </button>
          )}
        </RowActions>
      }
    />
  );
}
