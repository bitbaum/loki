import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

/**
 * What a list or page says when there is nothing in it — design reset rule 10
 * (docs/development/design-reset-2026-10.md): an icon, ONE line, and at most
 * one button. No border, no box, no second paragraph.
 *
 *   <EmptyState icon={Bot} title="No robots yet" action={<AddRobotButton />} />
 *
 * Bare children (no icon, title or action) is the dim one-liner for a small
 * section inside a page: `<EmptyState>Nothing added yet</EmptyState>`.
 *
 * `children` next to a `title` still renders, as a small line under it, so the
 * pages not yet rebuilt keep what they say. New code does not pass it: if the
 * line needs a second sentence, the sentence belongs in the title or on the
 * button.
 */
export function EmptyState({
  icon: Icon,
  title,
  action,
  size = "md",
  className,
  children,
}: {
  icon?: LucideIcon;
  /** The one line. */
  title?: string;
  /** The one button (a link styled as a button is fine). */
  action?: React.ReactNode;
  size?: Size;
  className?: string;
  children?: React.ReactNode;
}) {
  if (!Icon && !title && !action) {
    return <div className={cn("text-sm text-text-tertiary", className)}>{children}</div>;
  }
  const pad =
    size === "sm" ? "ui-empty-block-sm" : size === "lg" ? "ui-empty-block-lg" : "ui-empty-block-md";
  return (
    <div className={cn("ui-empty-block", pad, className)}>
      {Icon && <Icon className="ui-empty-icon" aria-hidden />}
      {title && <p className="ui-empty-title">{title}</p>}
      {children && <div className="ui-empty-helper">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
