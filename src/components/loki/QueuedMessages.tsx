"use client";

import { X } from "lucide-react";

/**
 * What will be sent next, shown so the operator knows the words were taken,
 * with a way to take them back. Sits between the thread and the composer.
 */
export function QueuedMessages({
  items,
  onRemove,
}: {
  items: Array<{ id: number; text: string }>;
  onRemove: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="ui-loki-queue" role="status" aria-live="polite">
      <span>Next:</span>
      {items.map((q) => (
        <span key={q.id} className="ui-loki-queue-item">
          <span className="truncate">{q.text}</span>
          <button
            type="button"
            className="ui-loki-queue-remove"
            onClick={() => onRemove(q.id)}
            aria-label={`Don't send: ${q.text}`}
            title="Don't send"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
