import { useId } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A section's heading — design reset rule 4
 * (docs/development/design-reset-2026-10.md): plain sentence case, 15px
 * semibold, the same ink as the content. Not letter-spaced capitals (that was
 * `ui-kicker`, which is now only for labels the size of a tag).
 *
 *   <SectionHeading title="Recently added" link={{ href: "/memory/all", label: "See all" }} />
 *
 * The 24px above a heading is the page's stack gap (PageLayout), the 8px below
 * is the heading's own. `right` takes something other than a link — a
 * ChoiceMenu ("Sort: Recent ▾"), say — and is ignored when `link` is set.
 */
export function SectionHeading({
  title,
  link,
  right,
  id,
  as: Tag = "h2",
  className,
}: {
  title: string;
  link?: { href: string; label: string };
  right?: React.ReactNode;
  id?: string;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("ui-section-head", className)}>
      <Tag id={id} className="ui-section-heading">
        {title}
      </Tag>
      {link ? (
        <Link href={link.href} className="ui-section-link">
          {link.label}
        </Link>
      ) : (
        right
      )}
    </div>
  );
}

/**
 * A titled block of a page: a SectionHeading and what it heads, as one
 * `<section>` named by its heading. Use it for every section of a rebuilt
 * page, so the spacing between sections is the page's and never re-typed.
 */
export function Section({
  title,
  link,
  right,
  className,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <SectionHeading id={id} title={title} link={link} right={right} />
      {children}
    </section>
  );
}
