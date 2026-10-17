import { isRuntimeAvailable } from "@/lib/runtime";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { getUserProjects } from "@/db/queries/user-projects";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { SESSIONS_DIR } from "@/lib/agent-config";
import { parseSessionFile } from "@/lib/session-content";
import { getApiUserId } from "@/lib/session";

// readFileSync has no Next.js dynamic signal — force dynamic so middleware runs.
export const dynamic = "force-dynamic";

export type SessionData =
  | {
      found: false;
    }
  | {
      found: true;
      done: string;
      next: string;
      tests: string;
      todos: string;
      health: string;
      raw: string;
    };

/** Find a session file matching the project name (case-insensitive, dash-tolerant). */
function findSessionFile(projectName: string): string | null {
  const sessionsDir = SESSIONS_DIR();
  if (!fs.existsSync(/*turbopackIgnore: true*/ sessionsDir)) return null;

  const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]/g, "");
  const target = normalize(projectName);

  try {
    const files = fs.readdirSync(/*turbopackIgnore: true*/ sessionsDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const stem = path.basename(file, ".md");
      if (normalize(stem) === target) return path.join(/*turbopackIgnore: true*/ sessionsDir, file);
    }
  } catch {
    return null;
  }

  return null;
}

export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = req.nextUrl.searchParams.get("project");
  if (!project || project.length > 100) {
    return NextResponse.json({ found: false } satisfies SessionData);
  }

  // These files are the SERVER's (~/.loki/sessions/<project>.md), written for
  // the projects the box builds — one name space for every account. Read only
  // a project this account owns, and only where the server's files can be
  // this account's at all: its own machine, or an account the box builds for.
  // Until 2026-10-17 any account could read any handoff by guessing a name.
  const [mayReadBox, projects] = await Promise.all([
    isRuntimeAvailable() ? Promise.resolve(true) : isFleetInfrastructureAllowed(userId),
    getUserProjects(userId).catch(() => []),
  ]);
  const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]/g, "");
  if (!mayReadBox || !projects.some((p) => normalize(p.name) === normalize(project))) {
    return NextResponse.json({ found: false } satisfies SessionData);
  }

  const filePath = findSessionFile(project);
  if (!filePath) return NextResponse.json({ found: false } satisfies SessionData);

  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8");
    const parsed = parseSessionFile(raw);
    return NextResponse.json({ found: true, ...parsed, raw } satisfies SessionData);
  } catch {
    return NextResponse.json({ found: false } satisfies SessionData);
  }
}
