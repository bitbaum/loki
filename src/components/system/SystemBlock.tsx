import type { LucideIcon } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

/**
 * One part of /system: a plain sentence-case heading and what it holds, on
 * the page — no box. The page was a stack of nineteen bordered cards, each
 * with an icon, a title like "Fleet Doctor" or "Global auto-continue" and a
 * coloured count; the design reset (docs/development/design-reset-2026-10.md)
 * reads it as sections of one page instead.
 */
export function SystemBlock({ children }: { children: React.ReactNode }) {
  return <section className="ui-sys-block">{children}</section>;
}

/** The block's heading. `icon` is accepted and not drawn: headings carry no icons. */
export function SystemBlockHeader({
  title,
  right,
}: {
  icon?: LucideIcon;
  title: string;
  right?: React.ReactNode;
}) {
  return <SectionHeading title={title} right={right} />;
}
