import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readJsonBody, z, isUniqueViolation } from "@/lib/api/route-helpers";
import { emptyToUndefined } from "@/lib/validation";
import {
  createUserProject,
  ensureUserProjectEntityLinks,
  countActiveProjects,
} from "@/db/queries/user-projects";
import { getTopActiveGoalByProject } from "@/db/queries/project-context";
import { getUserById } from "@/db/queries/users";
import { getProjectLimit } from "@/lib/plan";
import { normalizeProjectName } from "@/lib/project-name";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  dirPath: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(500).optional()),
  gitUrl: z.preprocess(emptyToUndefined, z.string().trim().url().optional()),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  stack: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  /** Where the project already lives on the web. Set at creation so the
   *  widget token minted next inherits its origin (an origin-less token runs
   *  anywhere) and "Open your site" has somewhere to open. */
  liveUrl: z.preprocess(emptyToUndefined, z.string().trim().url().max(1000).optional()),
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projects = await ensureUserProjectEntityLinks(userId);
  // Attach the goal each project is currently aiming at (the roadmap the
  // autopilot reads) so surfaces like the Loki panel can show it at a glance.
  const goalByEntity = await getTopActiveGoalByProject(userId);
  const withGoals = projects.map((p) => ({
    ...p,
    topGoal: p.entityProjectId ? (goalByEntity.get(p.entityProjectId) ?? null) : null,
  }));
  return NextResponse.json(withGoals);
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Default (owner) users are never limited.
  if (!user.isDefault) {
    const limit = getProjectLimit(user.plan);
    if (Number.isFinite(limit)) {
      const current = await countActiveProjects(userId);
      if (current >= limit) {
        return NextResponse.json(
          {
            error: `Project limit reached (${limit} on ${user.plan} plan). Upgrade to add more.`,
            limitReached: true,
          },
          { status: 403 },
        );
      }
    }
  }

  const dataOrResp = await readJsonBody(req, CreateBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  // Canonical lowercase-slug name (SSOT) so the registry stays consistent
  // across deployments instead of drifting Title-case vs slug.
  const name = normalizeProjectName(dataOrResp.name);
  if (!name)
    return NextResponse.json(
      { error: "Project name must contain letters or numbers." },
      { status: 400 },
    );
  try {
    const project = await createUserProject({ userId, ...dataOrResp, name });
    return NextResponse.json(project, { status: 201 });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      return NextResponse.json(
        { error: "You already have a project with that name." },
        { status: 409 },
      );
    }
    throw e;
  }
}
