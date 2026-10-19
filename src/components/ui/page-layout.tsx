import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHead, PageTitle } from "./page-title";

export function PageLayout({
  title,
  subtitle,
  right,
  back,
  maxWidth = "max-w-4xl",
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Parent to return to. Rendered ABOVE the title, which is where a back
   *  affordance is looked for — the flow pages each hand-rolled one below the
   *  h1 instead, leaving a stranded link row between the heading and the card
   *  it belonged to. */
  back?: { href: string; label: string };
  maxWidth?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("app-page space-y-7 md:space-y-9", maxWidth)}>
      <PageHead title={title} onlyTitle={!back && !subtitle && !right}>
        {back && (
          <Link href={back.href} className="ui-page-back">
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {back.label}
          </Link>
        )}
        <div className="ui-page-header">
          <div>
            <PageTitle title={title} />
            {subtitle && <p className="ui-page-subtitle">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0 sm:mt-1">{right}</div>}
        </div>
      </PageHead>
      {children}
    </div>
  );
}
