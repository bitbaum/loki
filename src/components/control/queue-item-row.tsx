"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckSquare, GripVertical, Pencil, Send, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Props for a single queue row. The parent QueueList builds one of these
 * per index from its own state — that's why every interaction handler is
 * passed in (the row stays purely presentational).
 */
export type RowProps = {
  index: number;
  item: string;
  isFirst: boolean;
  selected: boolean;
  isDragging?: boolean;
  isOverlay?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  editingIndex: number | null;
  editText: string;
  onSetEditText: (v: string) => void;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onSend?: () => void;
  onRemove?: () => void;
};

/**
 * Renders a single queue row — checkbox · drag handle · position · content
 * (or inline edit textarea) · send/remove actions. Lives in its own file so
 * edits to row layout don't scroll past the QueueList's drag-and-drop +
 * selection orchestration.
 */
export function QueueItemRow({
  index,
  item,
  isFirst,
  selected,
  isDragging,
  isOverlay,
  dragHandleProps,
  editingIndex,
  editText,
  onSetEditText,
  onToggleSelect,
  onStartEdit,
  onConfirmEdit,
  onCancelEdit,
  onSend,
  onRemove,
}: RowProps) {
  const editing = editingIndex === index;
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-4 py-2 sm:px-5",
        "border-b border-border-subtle last:border-b-0",
        isDragging && "opacity-20",
        isOverlay && "rounded-lg border border-border-default bg-surface-raised shadow-lg",
        selected && !isDragging && "bg-accent-primary/[0.04]",
      )}
    >
      {/* Checkbox */}
      <button
        onClick={onToggleSelect}
        title={selected ? "Deselect" : "Select"}
        className={cn(
          "ui-icon-nudge shrink-0 p-0.5 transition-colors",
          selected ? "text-accent-text" : "text-border-default hover:text-text-muted",
        )}
      >
        {selected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
      </button>

      {/* Drag handle — omitted in overlay (no interaction needed) */}
      {dragHandleProps ? (
        <button
          {...dragHandleProps}
          className="ui-icon-nudge shrink-0 cursor-grab touch-none text-text-muted hover:text-text-secondary active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div className="ui-icon-nudge w-3.5 shrink-0" />
      )}

      {/* Position indicator */}
      <span
        className={cn(
          "ui-icon-nudge shrink-0 text-micro font-bold tabular-nums",
          isFirst ? "text-accent-text" : "text-text-muted",
        )}
      >
        {index + 1}
      </span>

      {/* Content */}
      {editing ? (
        <textarea
          // Mounts only when this row enters edit mode — autoFocus replaces
          // the old ref + deferred .focus() (a ref may not cross render code).
          autoFocus
          value={editText}
          onChange={(e) => onSetEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onConfirmEdit();
            }
            if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={onConfirmEdit}
          rows={2}
          className="ui-input flex-1 resize-none text-sm"
          style={{ fieldSizing: "content", maxHeight: "6rem" } as React.CSSProperties}
        />
      ) : (
        <button
          onClick={onStartEdit}
          title="Click to edit"
          className={cn(
            "group/edit flex flex-1 items-start gap-1 text-left text-sm leading-snug transition-colors",
            isFirst ? "text-text-primary" : "text-text-tertiary",
            "hover:text-text-primary",
          )}
        >
          <span className="flex-1">{item}</span>
          <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-text-muted opacity-0 transition-opacity group-hover/edit:opacity-100" />
        </button>
      )}

      {/* Actions — hidden while editing */}
      {!editing && (
        <div className="mt-0.5 flex shrink-0 gap-0.5">
          {onSend && (
            <button
              onClick={onSend}
              title="Send now"
              className="ui-icon-btn rounded p-0.5 text-text-muted transition-colors hover:text-accent-text"
            >
              <Send className="h-3 w-3" />
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              title="Remove"
              className="ui-icon-btn rounded p-0.5 text-text-muted transition-colors hover:text-text-secondary"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Sortable wrapper — wires dnd-kit's useSortable into the row so the
 * parent can put it inside a SortableContext. Drag handle props bind to
 * the GripVertical button inside QueueItemRow.
 */
export function SortableQueueItem({ id, ...rowProps }: { id: string } & RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <QueueItemRow
        {...rowProps}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}
