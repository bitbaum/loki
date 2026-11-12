/**
 * POST /api/orangecat/sessions — OrangeCat reads one person's agent sessions.
 *
 * Same signed rail, same fail-closed posture and the same freshness window as
 * /api/orangecat/actor-status; the contract and the shaping live in
 * lib/integrations/orangecat-sessions.ts. Everything is read as the Loki user
 * linked to the OrangeCat actor in the body, never as anyone else.
 *
 * Three reads on one door:
 *  - no `project`, no `runId`: every project's session, in one row each.
 *  - `runId`: that one run, with the owner's full track (pull request, merge,
 *    deploy, live).
 *  - `project`: that project's row plus the last `items` things said in its
 *    Claude Code conversation.
 *
 * The conversation is the copy the server already keeps for the transcript
 * view (lastTranscript in lib/sse-bus). When nothing is cached, this joins as
 * a viewer for a few seconds, exactly as the transcript stream does, so the
 * runner posts a snapshot; then it leaves again.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import {
  getLatestRunForProjectKey,
  getOrchestrationRunById,
} from "@/db/queries/orchestration-runs";
import { enqueuePeekCommand } from "@/db/queries/pending-commands";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { isFreshIssuedAt } from "@/lib/integrations/orangecat-actor-status";
import {
  SESSIONS_DEFAULT_ITEMS,
  SESSIONS_MAX_ITEMS,
  SESSIONS_MAX_PROJECTS,
  orderSessions,
  shapeSessionRow,
  shapeTranscriptItems,
  type SessionRow,
  type SessionRowInput,
} from "@/lib/integrations/orangecat-sessions";
import { loadRunTrack, type TrackableRun } from "@/lib/run-track-load";
import { addPeekViewer, lastTranscript, removePeekViewer } from "@/lib/sse-bus";
import { mergeVisibleProjects } from "@/lib/visible-projects";

export const dynamic = "force-dynamic";

const Body = z.object({
  actorId: z.string().uuid(),
  issuedAt: z.string().datetime(),
  project: z.string().trim().min(1).max(120).optional(),
  runId: z.string().uuid().optional(),
  items: z.number().int().min(1).max(SESSIONS_MAX_ITEMS).optional(),
});

/** How long a read waits for the runner's first snapshot of a conversation. */
const SNAPSHOT_WAIT_MS = 6_000;
const SNAPSHOT_POLL_MS = 300;

type Presence = SessionRowInput["presence"];
type RunRow = TrackableRun & { projectKey: string };

async function rowFor(
  userId: string,
  project: { name: string; builderPref?: string | null },
  run: RunRow | null,
  presence: Presence,
  ownerView: boolean,
): Promise<SessionRow> {
  const loaded = run ? await loadRunTrack(userId, run, { ownerView }).catch(() => null) : null;
  const tab = run?.payload?.sessionTab ?? project.name;
  const pr = loaded?.fix && !loaded.fix.foreignPr ? (loaded.fix.pr?.url ?? null) : null;
  return shapeSessionRow({
    project: project.name,
    builderPref: project.builderPref ?? null,
    presence,
    run:
      run && loaded
        ? {
            id: run.id,
            state: loaded.canonical.state,
            label: loaded.canonical.label,
            reason: loaded.canonical.reason,
            task: loaded.prompt?.text ?? null,
            track: loaded.track.summary,
            prUrl: pr,
            lastProgressAt: loaded.snap?.lastProgressAt ?? null,
          }
        : null,
    transcriptAt: lastTranscript(userId, tab)?.at ?? null,
  });
}

/** The cached conversation, asking the runner for a snapshot when there is none. */
async function readTranscript(userId: string, tab: string) {
  const cached = lastTranscript(userId, tab);
  if (cached) return cached;
  const command = { tab };
  if (addPeekViewer(userId, tab)) {
    await enqueuePeekCommand(userId, "peek_start", command).catch(() => {});
  }
  try {
    const until = Date.now() + SNAPSHOT_WAIT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, SNAPSHOT_POLL_MS));
      const frame = lastTranscript(userId, tab);
      if (frame) return frame;
    }
    return null;
  } finally {
    if (removePeekViewer(userId, tab)) {
      await enqueuePeekCommand(userId, "peek_stop", command).catch(() => {});
    }
  }
}

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "sessions not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, issuedAt, project: wanted, runId, items } = dataOrResp;

  // Signed, but with no nonce: without this a captured request replays forever.
  if (!isFreshIssuedAt(issuedAt)) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  try {
    const user = await getUserByOrangeCatActorId(actorId);
    if (!user) {
      return NextResponse.json({ ok: true, linked: false, sessions: [] });
    }

    const [own, org, presence] = await Promise.all([
      getUserProjects(user.id).catch(() => []),
      getOrgProjects(user.id).catch(() => []),
      getBuilderPresence(user.id).catch(() => ({ cloud: false, local: false, any: false })),
    ]);
    const projects = mergeVisibleProjects(own, org);
    const generatedAt = new Date().toISOString();
    const builders = { cloud: presence.cloud, local: presence.local };

    if (runId) {
      const run = await getOrchestrationRunById(user.id, runId);
      if (!run) {
        return NextResponse.json(
          { error: "run not found", detail: "No run with that id belongs to this account." },
          { status: 404 },
        );
      }
      const project = projects.find(
        (p) => p.name.toLowerCase() === run.projectKey.toLowerCase(),
      ) ?? { name: run.projectKey };
      const row = await rowFor(user.id, project, run, presence, true);
      return NextResponse.json({ ok: true, linked: true, generatedAt, builders, sessions: [row] });
    }

    if (wanted) {
      const project = projects.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
      if (!project) {
        const available = projects.map((p) => p.name).sort((a, b) => a.localeCompare(b));
        return NextResponse.json(
          {
            error: "project not found",
            detail: `No project named "${wanted}". Projects you can read: ${available.join(", ") || "none yet"}.`,
            available,
          },
          { status: 404 },
        );
      }
      const run = await getLatestRunForProjectKey(user.id, project.name);
      const tab = run?.payload?.sessionTab ?? project.name;
      const [row, frame] = await Promise.all([
        rowFor(user.id, project, run, presence, true),
        readTranscript(user.id, tab),
      ]);
      return NextResponse.json({
        ok: true,
        linked: true,
        generatedAt,
        builders,
        sessions: [row],
        transcript: frame
          ? {
              project: project.name,
              at: new Date(frame.at).toISOString(),
              items: shapeTranscriptItems(frame.items, items ?? SESSIONS_DEFAULT_ITEMS),
            }
          : null,
      });
    }

    // The list never reaches GitHub or spends the owner's budget: ownerView
    // is off, so each row is the run's own facts and its cached ledger.
    const rows = await Promise.all(
      projects.map(async (project) =>
        rowFor(
          user.id,
          project,
          await getLatestRunForProjectKey(user.id, project.name).catch(() => null),
          presence,
          false,
        ),
      ),
    );
    return NextResponse.json({
      ok: true,
      linked: true,
      generatedAt,
      builders,
      sessions: orderSessions(rows).slice(0, SESSIONS_MAX_PROJECTS),
    });
  } catch (err) {
    console.error("[orangecat/sessions] failed:", (err as Error).message);
    return NextResponse.json({ error: "sessions failed" }, { status: 500 });
  }
}
