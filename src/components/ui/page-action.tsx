"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { Plus, type LucideIcon } from "lucide-react";
import { useTopbarActionSlot } from "@/components/shell/TopbarSlot";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NARROW_QUERY } from "@/hooks/use-is-narrow";

/**
 * Where a page's ONE primary action lives — design reset rule 5
 * (docs/development/design-reset-2026-10.md): top right, in the same place on
 * every page. On a phone that is the app top bar, just before the avatar (where
 * Claude puts "new chat"); from md up, the right of the page header. One
 * element, moved — never two copies, so an action that owns state (the dialog
 * it opens) keeps it.
 *
 * PageLayout renders this for its `action` prop; a page with its own header
 * can render it directly. Put a PageActionButton, or a ModalForm with
 * `trigger="page-action"`, inside.
 */
export function PageAction({ children }: { children: React.ReactNode }) {
  const phone = useMediaQuery(NARROW_QUERY);
  const slot = useTopbarActionSlot();
  if (phone && slot) return createPortal(children, slot);
  // The server render and the first one in the browser: in place, hidden on a
  // phone until it moves into the bar, so it never jumps from header to bar.
  // Outside the app shell there is no bar, and it simply stays here.
  return <div className={slot ? "flex shrink-0 max-md:hidden" : "flex shrink-0"}>{children}</div>;
}

/**
 * The primary action's look: a filled 40px circle with its icon on a phone, a
 * pill with icon and verb from md up. `label` is the accessible name always.
 */
export function PageActionButton({
  label,
  icon: Icon = Plus,
  onClick,
  href,
  disabled,
}: {
  /** The verb — "New goal", "Add robot". Shown from md up, read aloud always. */
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  /** A link to another page instead of a button. */
  href?: string;
  disabled?: boolean;
}) {
  const inner = (
    <>
      <Icon className="h-5 w-5 md:h-4 md:w-4" aria-hidden />
      <span className="ui-page-action-label">{label}</span>
    </>
  );
  if (href)
    return (
      <Link href={href} className="ui-page-action" title={label}>
        {inner}
      </Link>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ui-page-action"
      title={label}
    >
      {inner}
    </button>
  );
}
