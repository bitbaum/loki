"use client";

import { AttachMenu, DEFAULT_ATTACH_MENU_LABELS } from "@bitbaum/chatkit/react";
import { FileText, X } from "lucide-react";
import { MAX_ATTACHMENTS } from "@/lib/loki/attachments";
import type { AttachmentsController } from "@/hooks/use-attachments";

/**
 * The attach control and the row of staged files, for any composer.
 *
 * An image gets a real thumbnail rather than a filename chip. On a phone the
 * file is called `IMG_20260826_0942.jpg` and every screenshot is called
 * something like it — the name identifies nothing, so a name-only chip cannot
 * answer the one question that matters before you hit send: *is that the right
 * picture?* The thumbnail answers it at a glance.
 */

/**
 * The paperclip is chatkit's: on a phone it opens Camera / Photos / Files, one
 * input each. This file used to own a bare `<input accept="image/*,text/*…">`,
 * and Android answers a mixed accept with a chooser of capture apps (Camera,
 * Recorder, "Photos & Videos") and no file browser — attaching a screenshot
 * was effectively impossible from a phone. Never re-roll a file input here.
 */
export function AttachButton({
  attachments,
  label = "Attach a screenshot or file",
}: {
  attachments: AttachmentsController;
  label?: string;
}) {
  return (
    <AttachMenu
      onFiles={attachments.addFiles}
      disabled={attachments.full}
      labels={{
        ...DEFAULT_ATTACH_MENU_LABELS,
        attach: attachments.full ? `Up to ${MAX_ATTACHMENTS} files` : label,
      }}
    />
  );
}

export function AttachmentStrip({ attachments }: { attachments: AttachmentsController }) {
  if (attachments.attachments.length === 0 && !attachments.note) return null;
  return (
    <div className="ui-attach-strip">
      {attachments.attachments.map((a) => {
        const key = attachments.keyOf(a);
        return (
          <div key={key} className="ui-attach-item">
            {a.kind === "image" && a.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.previewUrl} alt={a.name} className="ui-attach-thumb" />
            ) : (
              <span className="ui-attach-file">
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{a.name}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => attachments.remove(key)}
              className="ui-attach-remove"
              title={`Remove ${a.name}`}
              aria-label={`Remove ${a.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      {attachments.note && (
        <button
          type="button"
          onClick={attachments.clearNote}
          className="ui-attach-note"
          title="Dismiss"
        >
          {attachments.note}
        </button>
      )}
    </div>
  );
}
