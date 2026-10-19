// The Sessions drawer's list (added 2026-06-05; reworded 2026-10-19).
//
// Every project the signed-in user owns, joined with its project_states row,
// reduced to what the drawer says: whether its agent is open right now and
// what it is doing, or when an agent last worked on it (lib/session-list).
//
// Why a separate endpoint vs reusing /api/control?
//   - /api/control is /control-page-specific: pulls live agent terminals, runs git
//     status on every project dir, returns agent process info etc.
//     ~50KB+ payload per call. The drawer is reachable from every
//     authenticated page and polls every 30s while open, so it must stay tiny.
//   - This endpoint is read-only and DB-only — no shell-outs, no git, no
//     runner dependency. Cheap to call frequently.

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getProjects } from "@/db/queries/projects";
import { getProjectStatesByUserId } from "@/db/queries/project-states";
import { sessionListRow, type SessionListRow } from "@/lib/session-list";

export type SessionSnapshotItem = {
  id: string;
  name: string;
  /** The terminal tab the session runs in, when one is known — the drawer
   *  opens /terminal on it. */
  tab: string | null;
  session: SessionListRow;
};

export type SessionSnapshot = {
  projects: SessionSnapshotItem[];
  generatedAt: string;
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [projects, states] = await Promise.all([
    getProjects(userId),
    getProjectStatesByUserId(userId).catch(() => []),
  ]);

  // project_key matches the tab name OR the project entity name (the runner
  // writes whichever it sees first; both are fine as join keys here).
  const stateByKey = new Map<string, (typeof states)[number]>();
  for (const s of states) {
    if (s.projectKey) stateByKey.set(s.projectKey.toLowerCase(), s);
  }

  const now = Date.now();
  const items: SessionSnapshotItem[] = projects.map((p) => {
    const s = stateByKey.get(p.name.toLowerCase());
    return {
      id: p.id,
      name: p.name,
      tab: s ? (s.tabName ?? s.projectKey) : null,
      session: sessionListRow(s ?? null, now),
    };
  });

  return NextResponse.json({
    projects: items,
    generatedAt: new Date().toISOString(),
  });
}
