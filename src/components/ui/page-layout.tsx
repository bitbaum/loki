import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHead, PageTitle } from "./page-title";
import { PageAction } from "./page-action";

/**
 * A page: its one title, its one primary action, and its sections 24px apart
 * (docs/development/design-reset-2026-10.md).
 *
 * - `title` is the page's only <h1>. On a phone the top bar already names the
 *   page, so the h1 is read but not drawn there (PageTitle).
 * - `action` is the ONE primary action (PageActionButton, or a ModalForm with
 *   `trigger="page-action"`): a round button in the phone top bar, at the
 *   right of this header from md up.
 * - `subtitle` is kept for the pages not rebuilt yet. New pages leave it out:
 *   no explanation line under a title (rule 2).
 * - `right` is for anything that is not the primary action and must sit in
 *   the header on every width.
 */
export function PageLayout({
  title,
  subtitle,
  right,
  action,
  back,
  maxWidth = "max-w-4xl",
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** The page's one primary action — see above. */
  action?: React.ReactNode;
  /** Parent to return to. Rendered ABOVE the title, which is where a back
   *  affordance is looked for — the flow pages each hand-rolled one below the
   *  h1 instead, leaving a stranded link row between the heading and the card
   *  it belonged to. */
  back?: { href: string; label: string };
  maxWidth?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("app-page space-y-6 md:space-y-8", maxWidth)}>
      {/* `action` leaves the header on a phone (it moves to the top bar), so
          it does not keep an otherwise empty header drawn there. */}
      <PageHead title={title} onlyTitle={!back && !subtitle && !right}>
        {back && (
          <Link href={back.href} className="ui-page-back">
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {back.label}
          </Link>
        )}
        <div className="ui-page-header">
          <div className="min-w-0">
            <PageTitle title={title} />
            {subtitle && <p className="ui-page-subtitle">{subtitle}</p>}
          </div>
          {(right || action) && (
            // A filled 40px action centres on the 32px title line; other
            // controls keep their old 4px drop.
            <div className={cn("flex shrink-0 items-center gap-2", right ? "sm:mt-1" : "sm:-mt-1")}>
              {right}
              {action && <PageAction>{action}</PageAction>}
            </div>
          )}
        </div>
      </PageHead>
      {children}
    </div>
  );
}
