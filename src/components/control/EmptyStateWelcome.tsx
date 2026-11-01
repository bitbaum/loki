"use client";

import { useInsideFleetRunner } from "@/hooks/use-inside-fleet-runner";
import Link from "next/link";
import { GitBranch, Sparkles } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

// Empty-state welcome for /control when the user has zero projects.
// The two proactive suggesters (GitHubRepoSuggestions, LocalDevSuggestions)
// render above this when their respective signals exist — this card grid
// remains the fallback for users without either signal.

type WelcomeCardProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: ReactNode;
  cta: string;
  variant?: "primary" | "secondary";
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

function WelcomeCard({
  icon: Icon,
  title,
  body,
  cta,
  variant = "primary",
  ...rest
}: WelcomeCardProps) {
  const iconClass = variant === "primary" ? "text-accent-text" : "text-text-secondary";
  const ctaClass = variant === "primary" ? "text-accent-text" : "text-text-secondary";
  const shared =
    "ui-card-shell hover:border-accent-primary transition-colors p-4 flex flex-col gap-2 group text-left";
  const content = (
    <>
      <Icon className={`h-5 w-5 ${iconClass}`} />
      <div>
        <div className="font-medium text-text-primary">{title}</div>
        <div className="text-sm text-text-muted mt-1">{body}</div>
      </div>
      <div className={`text-xs ${ctaClass} mt-auto pt-2 group-hover:underline`}>{cta}</div>
    </>
  );

  return "href" in rest && rest.href ? (
    <Link href={rest.href} className={shared}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={rest.onClick} className={shared}>
      {content}
    </button>
  );
}

export function EmptyStateWelcome({
  onAddManual,
  onBootstrap,
}: {
  onAddManual: () => void;
  onBootstrap?: () => void;
}) {
  // Users already inside Fleet Runner shouldn't see "Install Fleet Runner" —
  // they have it. SSOT detection lives in useInsideFleetRunner.
  const insideFleetRunner = useInsideFleetRunner();

  return (
    <section className="ui-card-shell-raised p-6 md:p-8">
      <div className="space-y-1 mb-5">
        <h2 className="ui-page-title">Add a project</h2>
        <p className="ui-page-subtitle">New, or one you already have.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {onBootstrap ? (
          <WelcomeCard
            icon={Sparkles}
            title="New"
            body="Say what you want. Loki sets it up and starts building."
            cta="Start →"
            onClick={onBootstrap}
          />
        ) : (
          <WelcomeCard
            icon={Sparkles}
            title="New"
            body="Name it. We make the GitHub repo. Clone when you want."
            cta="Start →"
            href="/control/new-from-scratch"
          />
        )}

        <WelcomeCard
          icon={GitBranch}
          title="I already have one"
          body="Import from GitHub, or from a folder on this machine."
          cta="Import →"
          href="/control/import"
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          onClick={onAddManual}
          className="min-h-11 text-text-secondary hover:text-text-primary"
        >
          Add without git
        </button>
        {insideFleetRunner ? (
          <Link
            href="/control/import-local"
            className="inline-flex min-h-11 items-center text-text-secondary hover:text-text-primary"
          >
            Import from this computer
          </Link>
        ) : (
          <Link
            href="/download"
            className="inline-flex min-h-11 items-center text-text-secondary hover:text-text-primary"
          >
            Get Fleet Runner
          </Link>
        )}
      </div>
    </section>
  );
}
