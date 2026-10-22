"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { AiAssistBar } from "@/components/ui/ai-assist-bar";
import { PageActionButton } from "@/components/ui/page-action";
import { setActiveForm } from "@/lib/active-form";
import type { UseAiForm } from "@fleet/ai-forms/react";

interface Props {
  /** Trigger button label shown next to Plus icon. Default: "Add". */
  triggerLabel?: string;
  /**
   * How the trigger looks. "page-action" makes it the page's one primary
   * action (a round + in the phone top bar, a pill in the header from md up)
   * — render it inside <PageAction>, or pass it as PageLayout's `action`.
   * "secondary" is the quiet bordered button, for an empty state's one
   * action when the page action already carries the filled one. "none"
   * draws no trigger at all: the form is opened by its caller (with
   * `defaultOpen`) from a control elsewhere, such as a row's menu.
   */
  trigger?: "button" | "page-action" | "secondary" | "none";
  /**
   * Controlled open state, for a form opened by something else (a choice
   * sheet). With `trigger="none"` nothing is drawn until `open` is true.
   */
  open?: boolean;
  /** Called with false when the dialog closes, in controlled mode. */
  onOpenChange?: (open: boolean) => void;
  /** Modal header title. */
  title: string;
  /** Submit button text when idle. */
  submitLabel: string;
  /** Submit button text while saving. Default: "Saving…". */
  savingLabel?: string;
  /** Modal width. Default: "sm". */
  size?: "sm" | "md" | "lg";
  /** Render with the modal already open (e.g. deep links like ?new=1). Default: false. */
  defaultOpen?: boolean;
  /** Disables submit button (e.g. required field is empty). */
  canSubmit: boolean;
  saving: boolean;
  error: string | null;
  /**
   * Called on submit. Return true to close + reset; false to keep modal open
   * (leaving the error state for useCreateMutation to populate).
   */
  onSubmit: () => Promise<boolean>;
  /**
   * Called whenever the modal closes — both on success and on manual dismiss.
   * Use this to reset local field state and clear errors.
   */
  onReset: () => void;
  /**
   * Pass a `useAiForm` handle to put the "describe it / change it" bar above
   * the fields. Every form built on ModalForm gets assistance by adding this
   * one prop — there is no per-form UI to write.
   */
  assist?: UseAiForm;
  /** Prompt shown in the assist bar while the form is still empty. */
  assistPlaceholder?: string;
  /** Form fields rendered inside the modal. */
  children: React.ReactNode;
}

export function ModalForm({
  triggerLabel = "Add",
  trigger = "button",
  title,
  submitLabel,
  savingLabel = "Saving…",
  size = "sm",
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  canSubmit,
  saving,
  error,
  onSubmit,
  onReset,
  assist,
  assistPlaceholder,
  children,
}: Props) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };

  // Kept in a ref and read at call time: `useAiForm` returns a new object every
  // render, so publishing it directly would notify subscribers on every
  // keystroke. Only open/close changes the published handle.
  const assistRef = useRef<UseAiForm | undefined>(assist);
  useEffect(() => {
    assistRef.current = assist;
  });

  const hasAssist = assist !== undefined;
  useEffect(() => {
    if (!open || !hasAssist) return;
    setActiveForm({ title, getAssist: () => assistRef.current });
    return () => setActiveForm(null);
  }, [open, hasAssist, title]);

  const close = () => {
    setOpen(false);
    onReset();
    // Clear the conversation too — reopening the modal starts a new thing, and
    // stale turns would let a follow-up refer to a form that no longer exists.
    assist?.reset();
  };

  // As the page action, the trigger lives in the phone top bar (PageAction),
  // and the bar is hidden while any dialog is open (fc-overlay-open) — a
  // dialog rendered inside it would vanish with it. It opens only after a
  // click, so `document` is always there.
  const portal = (node: React.ReactNode) =>
    trigger === "button" || trigger === "secondary" ? node : createPortal(node, document.body);

  const handleSubmit = async () => {
    const ok = await onSubmit();
    if (ok) close();
  };

  return (
    <>
      {trigger === "none" ? null : trigger === "page-action" ? (
        <PageActionButton label={triggerLabel} onClick={() => setOpen(true)} />
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={trigger === "secondary" ? "ui-btn-secondary" : "ui-btn-confirm"}
        >
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </button>
      )}

      {open &&
        portal(
          <Modal onClose={close} size={size}>
            {/* form: Enter in any <input> submits natively; textarea doesn't */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit && !saving) handleSubmit();
              }}
              className="contents"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{title}</div>
                <button
                  type="button"
                  onClick={close}
                  className="p-1 text-text-tertiary hover:text-text-secondary rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {assist && <AiAssistBar assist={assist} fillPlaceholder={assistPlaceholder} />}

              <div className="space-y-3">{children}</div>

              {error && <div className="ui-box-error">{error}</div>}

              <button type="submit" disabled={saving || !canSubmit} className="ui-btn-submit">
                {saving ? (
                  <>
                    <Loader2 className="ui-spinner" /> {savingLabel}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> {submitLabel}
                  </>
                )}
              </button>
            </form>
          </Modal>,
        )}
    </>
  );
}
