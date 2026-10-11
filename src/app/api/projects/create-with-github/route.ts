// Cloud-side "start a new project from scratch" — creates a brand new GitHub
// repo AND the matching Loki project record in one round-trip. For users
// with an idea but no local runtime; they clone the repo afterward.
//
// Companion to /api/project/bootstrap (full local-stack scaffold, needs runner)
// and /api/projects/[id]/provision (link a repo to an EXISTING project).
//
// Repo creation + template seeding are shared via @/lib/github-provision.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { getRepoWriteToken } from "@/lib/github-org-token";
import { NO_PLACE_FOR_CODE } from "@/lib/kickoff/steps";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { getUserProjectByEntityId, updateUserProject } from "@/db/queries/user-projects";
import { CODE_CUSTODY } from "@/db/schema/user-projects";
import { createProject } from "@/db/queries/projects";
import { SOURCE_LOKI_UI } from "@/lib/constants";
import { TEMPLATES, renderTemplate } from "@/lib/project-templates";
import { provisionGithubRepo } from "@/lib/github-provision";
import { scheduleProjectProfileReindexByEntityId } from "@/lib/rag/reindex-project-profile";

export const maxDuration = 60;

const Body = z.object({
  name: z.string().trim().min(1, "name is required").max(80),
  description: z.string().trim().max(300).optional(),
  visibility: z.enum(["private", "public"]).default("private"),
  init_readme: z.boolean().default(true),
  template: z
    .enum(["bare", "nextjs-tailwind", "python-fastapi", "hono-cloudflare", "html-tailwind"])
    .default("bare"),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { name, description, visibility, init_readme, template } = parsed.data;

  // A brand-new repository is Loki's to keep, for any signed-in account.
  const write = await getRepoWriteToken(userId, { lokiKept: true });
  const token = write?.token ?? null;
  if (!token) {
    return NextResponse.json({ error: NO_PLACE_FOR_CODE, hasGithub: false }, { status: 400 });
  }

  const result = await provisionGithubRepo(token, {
    name,
    description,
    visibility,
    initReadme: init_readme,
    template,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, status: result.status },
      { status: result.status === 422 ? 409 : 502 },
    );
  }
  const { repo, templateSeeded } = result;

  // Now create the Loki project entity linked to the new repo.
  let projectId: string;
  let projectName: string;
  try {
    const project = await createProject(
      userId,
      { name, description: description ?? undefined, gitUrl: repo.html_url },
      SOURCE_LOKI_UI,
    );
    projectId = project.id;
    projectName = project.name;
    // Custody: the server's token made this repository, so Loki keeps it for
    // the person (and may archive it or hand it over later).
    const up = await getUserProjectByEntityId(userId, project.id).catch(() => null);
    if (up) {
      await updateUserProject(up.id, userId, {
        codeCustody: write?.source === "org" ? CODE_CUSTODY.LOKI : CODE_CUSTODY.OWN,
      }).catch(() => null);
    }
    scheduleProjectProfileReindexByEntityId(userId, project.id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // The GitHub repo IS created; we just couldn't add the FC row. Surface the URL.
    return NextResponse.json(
      {
        ok: false,
        error: `Project record could not be created (${msg.includes("duplicate") ? "duplicate name" : "db error"}), but the GitHub repo is live:`,
        gitUrl: repo.html_url,
        cloneCmd: `git clone ${repo.ssh_url}`,
      },
      { status: 409 },
    );
  }

  const tpl = TEMPLATES[template];
  const firstTask = renderTemplate(tpl.firstTask, {
    name: projectName,
    description: description ?? `Started from Loki · ${name}`,
  });

  // A link to a private repository in the fleet's org is a 404 for a person
  // who holds no credential there. The page shows the link only when they can
  // open it: their own token made it, or they are entitled to the org.
  const viewerCanOpenRepo =
    write?.source === "user" || !repo.private || (await isFleetInfrastructureAllowed(userId));

  return NextResponse.json({
    ok: true,
    project: { id: projectId, name: projectName },
    viewerCanOpenRepo,
    repo: {
      name: repo.name,
      full_name: repo.full_name,
      gitUrl: repo.html_url,
      sshUrl: repo.ssh_url,
      cloneUrl: repo.clone_url,
      private: repo.private,
    },
    template,
    templateSeeded,
    infra: tpl.infra,
    firstTask,
    cloneCmd: `git clone ${repo.ssh_url}`,
    cloneHttpsCmd: `git clone ${repo.clone_url}`,
  });
}
