"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { FolderPlus, Globe } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { List, ListRow } from "@/components/ui/list-row";
import { PageActionButton } from "@/components/ui/page-action";
import { NewPreviewButton } from "./NewPreviewButton";
import { NewProjectButton } from "./NewProjectButton";

type Form = "site" | "add" | null;

/**
 * The /projects page's ONE primary action (design reset rule 5): a round `+`
 * that asks which kind of new project — "Build a site" or "Add an existing
 * project" — and opens that form. There were two black buttons side by side
 * ("Build a preview", "Add") above the list (owner, 2026-10-21).
 *
 * An account the fleet does not build sites for (lib/execution-access) is
 * never offered the site — the old form ended in a refusal — so for it the
 * `+` opens "Add" directly: one option is not a choice.
 */
export function NewProjectChooser({
  canBuildSite,
  savedCode = "",
  autoOpen = false,
  initialName,
  initialDescription,
  variant = "page-action",
}: {
  canBuildSite: boolean;
  /** The access code the owner chose last time, for "Build a site". */
  savedCode?: string;
  /** /projects?new=1 — open "Add" straight away (OrangeCat's deep link). */
  autoOpen?: boolean;
  initialName?: string;
  initialDescription?: string;
  /** "button": the same choice from an empty list, as a plain button. */
  variant?: "page-action" | "button";
}) {
  const [choosing, setChoosing] = useState(false);
  const [form, setForm] = useState<Form>(autoOpen ? "add" : null);
  const titleId = useId();

  const start = () => (canBuildSite ? setChoosing(true) : setForm("add"));
  const pick = (next: Form) => {
    setChoosing(false);
    setForm(next);
  };
  const closed = (open: boolean) => {
    if (!open) setForm(null);
  };

  return (
    <>
      {variant === "page-action" ? (
        <PageActionButton label="New project" onClick={start} />
      ) : (
        <button type="button" onClick={start} className="ui-btn-secondary min-h-11">
          New project
        </button>
      )}
      {choosing &&
        // To <body>: the phone top bar this button sits in hides while a
        // dialog is open, and would take the sheet with it.
        createPortal(
          <Modal
            onClose={() => setChoosing(false)}
            position="bottom-mobile"
            size="sm"
            padded={false}
            labelledBy={titleId}
            className="p-2"
          >
            <p id={titleId} className="ui-choice-sheet-title">
              New project
            </p>
            <List className="mx-0">
              <ListRow
                onClick={() => pick("site")}
                icon={Globe}
                title="Build a site"
                secondary="A first website for someone"
              />
              <ListRow
                onClick={() => pick("add")}
                icon={FolderPlus}
                title="Add an existing project"
                secondary="Name it and say what it is"
              />
            </List>
          </Modal>,
          document.body,
        )}
      {canBuildSite && (
        <NewPreviewButton savedCode={savedCode} open={form === "site"} onOpenChange={closed} />
      )}
      <NewProjectButton
        autoOpen={autoOpen}
        initialName={initialName}
        initialDescription={initialDescription}
        open={form === "add"}
        onOpenChange={closed}
      />
    </>
  );
}
