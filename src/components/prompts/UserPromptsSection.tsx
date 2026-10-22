"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Copy, Pencil } from "lucide-react";
import { Section } from "@/components/ui/section-heading";
import { SAVED_PROMPTS_TITLE } from "@/config/control-labels";
import { List, ListRow } from "@/components/ui/list-row";
import { RowActions } from "@/components/ui/row-actions";
import { DeleteButton } from "@/components/ui/delete-button";
import { timeAgo } from "@/lib/dates";
import { collapseDuplicates, dupeKey } from "@/lib/prompt-duplicates";
import { promptPlainText } from "@/lib/prompt-vars";
import { SAVED_PROMPT_SEARCH_SPEC, searchPrompts } from "@/lib/prompt-search";

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

/**
 * "Your prompts" on /prompts — the ones you saved, one row each, above
 * Loki's library because they grow with use.
 *
 * Each row is the prompt's name, ONE line saying what it does, and "Run";
 * tapping it opens the Run sheet. Repeat, Edit, the extra-copies clean-up
 * and Delete are the row's own menu. They used to be four glyphs, a tag row
 * and a "Saved 4 times, word for word" strip on every card.
 *
 * Duplicates: one row per distinct prompt (name + words). Identical copies
 * behind it are counted in its line and removed only by the menu's explicit
 * "Remove N extra copies" — never silently.
 */
export function UserPromptsSection({
  prompts,
  query = "",
  onRun,
  onSchedule,
  onEdit,
}: {
  prompts: UserPromptCard[];
  /** The page's search box: it finds your own prompts too, best match first. */
  query?: string;
  onRun: (prompt: UserPromptCard) => void;
  onSchedule: (prompt: UserPromptCard) => void;
  onEdit: (prompt: UserPromptCard) => void;
}) {
  const router = useRouter();
  const [removingCopiesOf, setRemovingCopiesOf] = useState<string | null>(null);
  const [copiesError, setCopiesError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Confirmation is the shared two-step DeleteButton. A failed delete throws,
   * so DeleteButton says so instead of the row silently coming back.
   */
  async function handleDelete(id: string) {
    const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Could not delete this prompt. Try again.");
    startTransition(() => router.refresh());
  }

  /** The explicit clean-up for identical copies. The newest stays. */
  async function removeExtraCopies(id: string) {
    setRemovingCopiesOf(id);
    setCopiesError(null);
    try {
      const res = await fetch(`/api/prompts/${id}/copies`, { method: "DELETE" });
      if (!res.ok) {
        setCopiesError("Could not remove the copies. Try again.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setCopiesError("Could not remove the copies. Try again.");
    } finally {
      setRemovingCopiesOf(null);
    }
  }

  const { visible: allVisible } = collapseDuplicates(prompts);
  // Your own rows per distinct prompt — what "Remove extra copies" can act on.
  const ownRows = new Map<string, UserPromptCard[]>();
  for (const p of prompts) {
    if (p.own === false) continue;
    const key = dupeKey(p);
    ownRows.set(key, [...(ownRows.get(key) ?? []), p]);
  }
  const searching = query.trim().length > 0;
  const visiblePrompts = searching
    ? searchPrompts(allVisible, SAVED_PROMPT_SEARCH_SPEC, (p) => p.body, query).map((h) => h.item)
    : allVisible;

  if (visiblePrompts.length === 0) return null;

  return (
    <Section title={SAVED_PROMPTS_TITLE}>
      {copiesError && (
        <p className="ui-prompt-sheet-error mb-2" role="alert">
          {copiesError}
        </p>
      )}
      <List aria-label={SAVED_PROMPTS_TITLE}>
        {visiblePrompts.map((p) => {
          const mine = ownRows.get(dupeKey(p)) ?? [];
          const extraCopies = Math.max(0, mine.length - 1);
          // Same name, different words: two real prompts. The line says when
          // each was saved, or two "Next Best Step" rows read as one twice.
          const sameName = allVisible.filter((v) => v.name === p.name).length > 1;
          const what = p.description || promptPlainText(p.body);
          const line = [
            extraCopies > 0 ? `${mine.length} copies` : null,
            sameName ? `saved ${timeAgo(new Date(p.updatedAt).getTime())}` : null,
            what,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <ListRow
              key={p.id}
              onClick={() => onRun(p)}
              title={p.name}
              secondary={line}
              trailing={<span className="ui-prompt-run-cue">Run</span>}
              menu={
                <RowActions label={`More for ${p.name}`}>
                  <button
                    type="button"
                    onClick={() => onSchedule(p)}
                    className="ui-menu-item"
                    role="menuitem"
                  >
                    <CalendarClock className="h-4 w-4 shrink-0" />
                    Repeat on a schedule
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(p)}
                    className="ui-menu-item"
                    role="menuitem"
                  >
                    <Pencil className="h-4 w-4 shrink-0" />
                    Edit
                  </button>
                  {extraCopies > 0 && (
                    <button
                      type="button"
                      onClick={() => removeExtraCopies(mine[0]!.id)}
                      disabled={removingCopiesOf !== null}
                      className="ui-menu-item"
                      role="menuitem"
                    >
                      <Copy className="h-4 w-4 shrink-0" />
                      Remove {extraCopies} extra {extraCopies === 1 ? "copy" : "copies"}
                    </button>
                  )}
                  {p.own !== false && (
                    <>
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
                    </>
                  )}
                </RowActions>
              }
            />
          );
        })}
      </List>
    </Section>
  );
}
