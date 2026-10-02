import { PageLayout } from "@/components/ui/page-layout";
import { NAV } from "@/config/navigation";
import { PROMPT_TEMPLATES } from "@/config/prompt-library";
import { PromptLibraryClient } from "@/components/prompts/PromptLibraryClient";
import { collapseDuplicates } from "@/lib/prompt-duplicates";
import { requirePageUserId } from "@/lib/session";
import { getProjects, getOrgEntityProjects } from "@/db/queries/projects";
import { listPromptsForUser } from "@/db/queries/prompts";

export const metadata = { title: "Prompts" };

export default async function PromptsPage() {
  const userId = await requirePageUserId();
  const [ownProjects, orgProjects, userPromptRows] = await Promise.all([
    getProjects(userId),
    getOrgEntityProjects(userId),
    listPromptsForUser(userId),
  ]);
  const projects = [...ownProjects, ...orgProjects];

  // FC defaults + user-owned prompts are merged at the client level so
  // search / filter / sort work across both sources. User prompts arrive
  // as a parallel typed list (not the PromptTemplate shape) so the UI can
  // render edit/delete affordances per-row.
  const userPrompts = userPromptRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    body: p.body,
    scope: p.scope as "global" | "project" | "org",
    projectId: p.projectId,
    orgId: p.orgId,
    tags: p.tags,
    source: p.source,
    forkedFromKey: p.forkedFromKey,
    runCount: p.runCount,
    successCount: p.successCount,
    updatedAt: p.updatedAt.toISOString(),
  }));

  // Count prompts the way the section below shows them — one per distinct
  // name + body. Counting rows said "8 custom" over a section that said
  // "2 saved" (2026-10-01): same prompts, two numbers.
  const customCount = collapseDuplicates(userPrompts).visible.length;
  const subtitle =
    customCount > 0
      ? `${PROMPT_TEMPLATES.length} Loki defaults · ${customCount} custom`
      : `${PROMPT_TEMPLATES.length} templates · fleet control, security, engineering, design, business`;

  return (
    <PageLayout title={NAV.prompts.label} subtitle={subtitle}>
      <PromptLibraryClient
        templates={PROMPT_TEMPLATES}
        projects={projects}
        userPrompts={userPrompts}
      />
    </PageLayout>
  );
}
