import Link from "next/link";
import { Package } from "lucide-react";
import { kitPlanForProject } from "@/lib/kit-plan/for-project";
import { kitPlanSentence } from "@/lib/kit-plan/plan";
import { cleanDescription } from "@/lib/project-display";
import type { ProjectDossier } from "@/db/queries/project-dossier";

/**
 * Before the first build: which shared parts the site will be built from, in
 * the owner's words ("search, sign-in and email"). Planned by the same code
 * the build's prompt uses (lib/kit-plan/for-project.ts), from what is written
 * so far; the build plans again once the kickoff has filled in the profile and
 * milestones, and what it was actually given is the "Planned" line under
 * Built from (ProjectPlannedKits).
 *
 * Information, never a gate: it has no button, the kickoff above starts
 * whether or not it is read, and when the plan looks wrong the way to change
 * it is the Story — what the plan is read from — one link away.
 */
export async function KitPlanPreview({
  dossier,
  clientWork,
}: {
  dossier: ProjectDossier;
  clientWork: boolean;
}) {
  const { detail, userProject } = dossier;
  const project = detail.project;
  const kit = await kitPlanForProject({
    name: project.name,
    entityId: project.id,
    description: cleanDescription(project.description),
    attrs: detail.attrs,
    goals: detail.linkedGoals,
    gitUrl: userProject?.gitUrl ?? project.gitUrl ?? null,
    clientWork,
  });
  const sentence = kitPlanSentence(kit.plan);
  if (!kit.applies || (!sentence && !kit.clientTokens)) return null;
  return (
    <section className="flex items-start gap-3 px-1" aria-labelledby="kit-plan-preview-title">
      <Package className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
      <div className="min-w-0 space-y-1 wrap-anywhere">
        <h2 id="kit-plan-preview-title" className="ui-kicker">
          Built from
        </h2>
        {sentence && <p className="text-sm text-text-primary">{sentence}</p>}
        {kit.clientTokens && (
          <p className="text-sm text-text-secondary">
            It is your client&apos;s site, so it gets their colours and fonts, not ours.
          </p>
        )}
        <p className="text-xs text-text-tertiary">
          Read from what you wrote about the site.{" "}
          <Link href="#context" className="ui-link-subtle">
            Not right? Change the story
          </Link>
          {" — the build starts either way."}
        </p>
      </div>
    </section>
  );
}
