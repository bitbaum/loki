"use client";

import { FileText, Loader2, X } from "lucide-react";
import type { useLokiAttachments } from "./use-loki-attachments";

/**
 * The files Loki put on the box from its own records, shown before anything
 * is sent — seeing them there is the person's approval for the agent to read
 * them (lib/feedback/untrusted.ts). Each says what it holds and can be taken
 * off; a note says when there was nothing to attach.
 */
export function LokiFiles({ loki }: { loki: ReturnType<typeof useLokiAttachments> }) {
  if (loki.files.length === 0 && !loki.note && !loki.busy) return null;
  return (
    <div className="ui-loki-files" role="status" aria-live="polite">
      {loki.busy && (
        <span className="ui-loki-file">
          <Loader2 className="ui-spinner-xs" aria-hidden="true" /> Reading the reports…
        </span>
      )}
      {loki.files.map((f) => (
        <span key={f.name} className="ui-loki-file" title={`From Loki: ${f.summary}`}>
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{f.name}</span>
          <span className="shrink-0 text-text-muted">· {f.summary}</span>
          <button
            type="button"
            onClick={() => loki.remove(f.name)}
            aria-label={`Remove ${f.name}`}
            className="ui-icon-action shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {loki.note && (
        <span className="ui-loki-file-note">
          {loki.note}
          <button
            type="button"
            onClick={loki.clearNote}
            aria-label="Dismiss"
            className="ui-icon-action shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  );
}
