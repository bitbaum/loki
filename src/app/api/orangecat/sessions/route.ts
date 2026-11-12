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
 *    deploy, live) and the agent's handoff once it reports. With `items`,
 *    also the last things said in THAT run's own session (a one-off or a
 *    parallel lane has its own tab). With `watch` (seconds), the bot follows
 *    the run: it holds the session as a viewer for that long, so the runner
 *    streams the conversation while the agent works (orangecat-watch.ts).
 *  - `project`: that project's row plus the last `items` things said in its
 *    Claude Code conversation.
 *
 * The conversation is the copy the server keeps for the transcript view
 * (lastTranscript in lib/sse-bus). When nobody is viewing the session, a
 * read joins as a viewer for a few seconds, exactly as the transcript stream
 * does, and waits for the snapshot the runner sends: an older copy alone may
 * be missing the latest turns, and is marked `live: false` when it is all
 * there is.
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
  shapeTranscript,
  type SessionRow,
  type SessionRowInput,
} from "@/lib/integrations/orangecat-sessions";
import { WATCH_MAX_SECONDS, watchTab } from "@/lib/integrations/orangecat-watch";
import type { BuilderChannel } from "@/lib/constants/statuses";
import { runHandoff } from "@/lib/run-handoff";
import { ORCHESTRATION_OUTCOME } from "@/lib/orchestration/contract";
import { loadRunTrack, type TrackableRun } from "@/lib/run-track-load";
import {
  addPeekViewer,
  lastTranscript,
  removePeekViewer,
  type TranscriptFrame,
} from "@/lib/sse-bus";
import { mergeVisibleProjects } from "@/lib/visible-projects";

export const dynamic = "force-dynamic";

const Body = z.object({
  actorId: z.string().uuid(),
  issuedAt: z.string().datetime(),
  project: z.string().trim().min(1).max(120).optional(),
  runId: z.string().uuid().optional(),
  items: z.number().int().min(1).max(SESSIONS_MAX_ITEMS).optional(),
  /** With runId: hold the run's session as a viewer for this many seconds. */
  watch: z.number().int().min(1).max(WATCH_MAX_SECONDS).optional(),
  /**
   * With runId: a follower's poll. The run's own facts and its cached ledger
   * only, never a look at GitHub: a bot polling every few seconds must not
   * spend the owner's GitHub budget (run-track-load's ownerView).
   */
  poll: z.boolean().optional(),
});

/** How long a read waits for the runner's first snapshot of a conversation. */
const SNAPSHOT_WAIT_MS = 6_000;
const SNAPSHOT_POLL_MS = 300;
/** A snapshot's batches arrive back to back; this long without one, it is whole. */
const SNAPSHOT_SETTLE_MS = 600;

type Presence = SessionRowInput["presence"];
type RunRow = TrackableRun & { projectKey: string };

/** The builder a run is on, when it is known: a peek is sent to that runner only. */
function runChannel(
  run: { payload?: object | null } | null,
  snapChannel: string | null | undefined,
): BuilderChannel | undefined {
  const raw =
    (run?.payload as { oneOffChannel?: unknown } | null | undefined)?.oneOffChannel ?? snapChannel;
  return raw === "cloud" || raw === "local" ? raw : undefined;
}

async function rowFor(
  userId: string,
  project: { name: string; builderPref?: string | null },
  run: RunRow | null,
  presence: Presence,
  ownerView: boolean,
): Promise<{ row: SessionRow; tab: string; channel: BuilderChannel | undefined }> {
  const loaded = run ? await loadRunTrack(userId, run, { ownerView }).catch(() => null) : null;
  const tab = run?.payload?.sessionTab ?? run?.projectKey ?? project.name;
  const pr = loaded?.fix && !loaded.fix.foreignPr ? (loaded.fix.pr?.url ?? null) : null;
  const row = shapeSessionRow({
    project: project.name,
    builderPref: project.builderPref ?? null,
    presence,
    run:
      run && !loaded
        ? runWithoutTrack(run)
        : run && loaded
          ? {
              id: run.id,
              state: loaded.canonical.state,
              label: loaded.canonical.label,
              reason: loaded.canonical.reason,
              task: loaded.prompt?.text ?? null,
              track: loaded.track.summary,
              prUrl: pr,
              lastProgressAt: loaded.snap?.lastProgressAt ?? null,
              handoff: run.finishedAt ? runHandoff(run.summary) : null,
            }
          : null,
    transcriptAt: lastTranscript(userId, tab)?.at ?? null,
  });
  return { row, tab, channel: runChannel(run, loaded?.snap?.builderChannel) };
}

/**
 * A run whose track could not be loaded still exists and is still open or
 * closed: said from the run's own row, never as Idle with no run, which a
 * follower would take for settled.
 */
function runWithoutTrack(run: RunRow): NonNullable<SessionRowInput["run"]> {
  const open = !run.finishedAt;
  const failed =
    !open &&
    run.outcome !== ORCHESTRATION_OUTCOME.SUCCESS &&
    run.outcome !== ORCHESTRATION_OUTCOME.PARTIAL;
  return {
    id: run.id,
    state: open ? "working" : failed ? "failed" : "done",
    label: open ? "Working" : failed ? "Failed" : "Done",
    reason: open ? null : failed ? "Its details could not be read just now." : null,
    task: null,
    track: null,
    prUrl: null,
    lastProgressAt: null,
    handoff: open ? null : runHandoff(run.summary),
  };
}

/** The newest copy once frames have stopped arriving for a moment, or at the deadline. */
async function settledFrame(
  userId: string,
  tab: string,
  frame: TranscriptFrame,
  until: number,
): Promise<TranscriptFrame> {
  let latest = frame;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, SNAPSHOT_SETTLE_MS));
    const next = lastTranscript(userId, tab);
    if (!next || next.at === latest.at) return latest;
    latest = next;
  }
  return latest;
}

/**
 * The conversation of one session, as fresh as it can be had in a few
 * seconds. When someone is already viewing it (a person on Terminal, or a
 * bot's watch), the server's copy is live. Otherwise this joins as a viewer,
 * which makes the runner send a snapshot, waits for a frame that arrived
 * after it joined, and leaves again; if none comes, the older copy is
 * returned marked not live, or null when there is none.
 */
async function readTranscript(
  userId: string,
  tab: string,
  channel?: BuilderChannel,
): Promise<{ frame: { at: number; items: TranscriptFrame["items"] }; live: boolean } | null> {
  const joinedAt = Date.now();
  const command = { tab, ...(channel ? { channel } : {}) };
  const first = addPeekViewer(userId, tab, channel);
  try {
    if (!first) {
      const cached = lastTranscript(userId, tab);
      return cached ? { frame: cached, live: true } : null;
    }
    await enqueuePeekCommand(userId, "peek_start", command).catch(() => {});
    const until = joinedAt + SNAPSHOT_WAIT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, SNAPSHOT_POLL_MS));
      const frame = lastTranscript(userId, tab);
      if (frame && frame.at >= joinedAt) {
        // The runner posts a snapshot in batches of 100 (transcript-streamer
        // MAX_BATCH): wait until no more arrive, or the tail is missing.
        return { frame: await settledFrame(userId, tab, frame, until), live: true };
      }
    }
    const older = lastTranscript(userId, tab);
    return older ? { frame: older, live: false } : null;
  } finally {
    if (removePeekViewer(userId, tab, channel)) {
      await enqueuePeekCommand(userId, "peek_stop", command).catch(() => {});
    }
  }
}

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "sessions not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, issuedAt, project: wanted, runId, items, watch, poll } = dataOrResp;

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
      const { row, tab, channel } = await rowFor(user.id, project, run, presence, !poll);
      // Start (or extend) the watch before reading, so the runner is already
      // streaming when the agent writes its answer.
      if (watch) await watchTab(user.id, tab, watch, channel);
      const read = items ? await readTranscript(user.id, tab, channel) : null;
      return NextResponse.json({
        ok: true,
        linked: true,
        generatedAt,
        builders,
        sessions: [row],
        ...(items
          ? {
              transcript: read ? shapeTranscript(project.name, read.frame, read.live, items) : null,
            }
          : {}),
      });
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
      const { row, tab, channel } = await rowFor(user.id, project, run, presence, true);
      const read = await readTranscript(user.id, tab, channel);
      return NextResponse.json({
        ok: true,
        linked: true,
        generatedAt,
        builders,
        sessions: [row],
        transcript: read
          ? shapeTranscript(project.name, read.frame, read.live, items ?? SESSIONS_DEFAULT_ITEMS)
          : null,
      });
    }

    // The list never reaches GitHub or spends the owner's budget: ownerView
    // is off, so each row is the run's own facts and its cached ledger.
    const rows = await Promise.all(
      projects.map(async (project) => {
        const latest = await getLatestRunForProjectKey(user.id, project.name).catch(() => null);
        return (await rowFor(user.id, project, latest, presence, false)).row;
      }),
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
