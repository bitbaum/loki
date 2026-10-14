"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./modal";

/** A source must be reachable from a phone or keyboard, not only a hover tooltip. */
export function CitationNote({
  records,
}: {
  records: { id: string; label: string; detail: string }[];
}) {
  const [open, setOpen] = useState(false);
  const heading = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="ui-loki-cite"
        title={records.map((r) => r.label).join(" · ")}
        aria-label={`View ${records.length} source${records.length === 1 ? "" : "s"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {records.length === 1 ? "Source" : "Sources"}
      </button>
      {open &&
        createPortal(
          <Modal onClose={close} position="bottom-mobile" labelledBy={heading}>
            <div className="flex items-center justify-between gap-3">
              <h2 id={heading} className="text-lg font-medium">
                Source details
              </h2>
              <button type="button" className="ui-btn-ghost ui-tap" onClick={close}>
                Close
              </button>
            </div>
            {records.map((r) => (
              <section key={r.id} className="space-y-1 min-w-0">
                <h3 className="text-sm font-medium break-words">{r.label}</h3>
                <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">
                  {r.detail}
                </p>
              </section>
            ))}
          </Modal>,
          document.body,
        )}
    </>
  );
}
