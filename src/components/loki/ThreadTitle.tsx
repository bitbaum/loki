"use client";

import { useEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import { useInlineEdit } from "@/hooks/use-inline-edit";

/** Long enough for any real title; the server clamps at 200 as well. */
const TITLE_MAX = 120;

/**
 * The open thread's name, and the way to change it.
 *
 * Loki names a thread from what it is about once the first answer lands
 * (lib/loki/thread-title.ts). A person's own name wins and is never
 * replaced, so this is the one place a title becomes theirs: click it (or
 * "Rename" in the phone menu), type, Enter. Escape or an unchanged title
 * leaves everything as it was.
 *
 * `editing`/`onEditingChange` let the phone header open the editor from its
 * menu; the desktop top bar leaves them unset and the title opens itself.
 */
export function ThreadTitle({
  title,
  onRename,
  editing: editingProp,
  onEditingChange,
  className = "ui-loki-thread-title",
}: {
  title: string;
  onRename: (title: string) => void;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  className?: string;
}) {
  const ie = useInlineEdit<string>(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlled = editingProp !== undefined;
  const editing = controlled ? editingProp : ie.editing;

  // Opened from outside (the phone menu): seed the draft with the title as it
  // is now, and put the cursor in the field.
  useEffect(() => {
    if (controlled && editingProp) {
      ie.start(title);
      inputRef.current?.focus();
    }
    // Only the open transition matters; re-seeding on every title change would
    // overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled, editingProp]);

  const close = () => {
    ie.cancel();
    onEditingChange?.(false);
  };
  const save = () => {
    const next = ie.draft.trim().slice(0, TITLE_MAX);
    if (next && next !== title) onRename(next);
    close();
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus={!controlled}
        value={ie.draft}
        onChange={(e) => ie.setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        maxLength={TITLE_MAX}
        aria-label="Conversation name"
        className="ui-input-inline ui-loki-thread-title-input"
      />
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        ie.start(title);
        onEditingChange?.(true);
      }}
      title="Rename this conversation"
    >
      <span className="truncate">{title}</span>
      <Pencil className="ui-loki-thread-title-pencil" aria-hidden />
    </button>
  );
}
