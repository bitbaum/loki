/**
 * One person's agent sessions, read: the list (at most 25 rows, what needs
 * the person first, with the `total`), one run, or one project with the last
 * things said in its conversation.
 *
 * Two doors read through here and nothing else: OrangeCat's signed rail
 * (/api/orangecat/sessions, as the Loki user linked to an OrangeCat actor)
 * and the person's own session or `ck_` token (/api/control/sessions). Both
 * answer the same thing, so an agent that steers a session over either one
 * reads what the person reads on Control and Watch.
 *
 * Shaping and the contract are lib/integrations/orangecat-sessions.ts. The
 * conversation is the copy the server keeps for the transcript view
 * (lastTranscript in lib/sse-bus). When nobody is viewing the session, a
 * read joins as a viewer for a few seconds, exactly as the transcript stream
 * does, and waits for the snapshot the runner sends: an older copy alone may
 * be missing the latest turns, and is marked `live: false` when it is all
 * there is.
 */
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import {
  getLatestRunForProjectKey,
  getOrchestrationRunById,
} from "@/db/queries/orchestration-runs";
import { enqueuePeekCommand } from "@/db/queries/pending-commands";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import {
  SESSIONS_DEFAULT_ITEMS,
  SESSIONS_MAX_PROJECTS,
  orderSessions,
  shapeSessionRow,
  shapeTranscript,
  type SessionRow,
  type SessionRowInput,
} from "@/lib/integrations/orangecat-sessions";
import { watchTab } from "@/lib/integrations/orangecat-watch";
import type { BuilderChannel } from "@/lib/constants/statuses";
import { projectPreferredChannel } from "@/lib/execution-access";
import { runHandoff } from "@/lib/run-handoff";
import { askedOf } from "@/lib/multi-dispatch-prompt";
import { ORCHESTRATION_OUTCOME } from "@/lib/orchestration/contract";
import { loadRunTrack, type TrackableRun } from "@/lib/run-track-load";
import {
  addPeekViewer,
  lastTranscript,
  removePeekViewer,
  type TranscriptFrame,
} from "@/lib/sse-bus";
import { mergeVisibleProjects } from "@/lib/visible-projects";

/** How long a read waits for the runner's first snapshot of a conversation. */
const SNAPSHOT_WAIT_MS = 6_000;
const SNAPSHOT_POLL_MS = 300;
/** A snapshot's batches arrive back to back; this long without one, it is whole. */
const SNAPSHOT_SETTLE_MS = 600;

type Presence = SessionRowInput["presence"];
type RunRow = TrackableRun & { projectKey: string };
type ProjectRef = {
  name: string;
  builderPref?: string | null;
  dirPath?: string | null;
  gitUrl?: string | null;
};

export type SessionsQuery = {
  /** One project: its row and the end of its conversation. */
  project?: string;
  /** One run: its row with the owner's full track. */
  runId?: string;
  /** How many conversation items. A project read always includes them. */
  items?: number;
  /** With runId: hold the run's session as a viewer for this many seconds. */
  watch?: number;
  /**
   * With runId: a follower's poll. The run's own facts and its cached ledger
   * only, never a look at GitHub: a caller polling every few seconds must not
   * spend the owner's GitHub budget (run-track-load's ownerView).
   */
  poll?: boolean;
};

/** HTTP status and JSON body; each door adds only what is its own. */
export type SessionsRead = { status: number; body: Record<string, unknown> };

/**
 * The builder a session is on: the one the run recorded, else the one the
 * project dispatches to. Always named, so a peek is claimed by that runner
 * only and shares the Terminal's viewer count for the session.
 */
function sessionChannel(
  run: { payload?: object | null } | null,
  snapChannel: string | null | undefined,
  project: ProjectRef,
): BuilderChannel {
  const raw =
    (run?.payload as { oneOffChannel?: unknown } | null | undefined)?.oneOffChannel ?? snapChannel;
  return raw === "cloud" || raw === "local" ? raw : projectPreferredChannel(project);
}

async function rowFor(
  userId: string,
  project: ProjectRef,
  run: RunRow | null,
  presence: Presence,
  ownerView: boolean,
): Promise<{ row: SessionRow; tab: string; channel: BuilderChannel }> {
  const loaded = run ? await loadRunTrack(userId, run, { ownerView }).catch(() => null) : null;
  const tab = run?.payload?.sessionTab ?? run?.projectKey ?? project.name;
  const channel = sessionChannel(run, loaded?.snap?.builderChannel, project);
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
              // What was asked, not the cross-project preamble the agent got.
              task: loaded.prompt?.text ? askedOf(loaded.prompt.text) : null,
              track: loaded.track.summary,
              prUrl: pr,
              lastProgressAt: loaded.snap?.lastProgressAt ?? null,
              handoff: run.finishedAt ? runHandoff(run.summary) : null,
            }
          : null,
    transcriptAt: lastTranscript(userId, tab)?.at ?? null,
    tab,
    channel,
  });
  return { row, tab, channel };
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
  channel: BuilderChannel,
): Promise<{ frame: { at: number; items: TranscriptFrame["items"] }; live: boolean } | null> {
  const joinedAt = Date.now();
  const command = { tab, channel };
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

/** Read one person's sessions, as that person. */
export async function readSessions(userId: string, query: SessionsQuery): Promise<SessionsRead> {
  const { project: wanted, runId, items, watch, poll } = query;
  const [own, org, presence] = await Promise.all([
    getUserProjects(userId).catch(() => []),
    getOrgProjects(userId).catch(() => []),
    getBuilderPresence(userId).catch(() => ({ cloud: false, local: false, any: false })),
  ]);
  const projects = mergeVisibleProjects(own, org);
  const generatedAt = new Date().toISOString();
  const builders = { cloud: presence.cloud, local: presence.local };

  if (runId) {
    const run = await getOrchestrationRunById(userId, runId);
    if (!run) {
      return {
        status: 404,
        body: { error: "run not found", detail: "No run with that id belongs to this account." },
      };
    }
    const project: ProjectRef = projects.find(
      (p) => p.name.toLowerCase() === run.projectKey.toLowerCase(),
    ) ?? { name: run.projectKey };
    const { row, tab, channel } = await rowFor(userId, project, run, presence, !poll);
    // Start (or extend) the watch before reading, so the runner is already
    // streaming when the agent writes its answer.
    if (watch) await watchTab(userId, tab, watch, channel);
    const read = items ? await readTranscript(userId, tab, channel) : null;
    return {
      status: 200,
      body: {
        ok: true,
        generatedAt,
        builders,
        sessions: [row],
        ...(items
          ? {
              transcript: read ? shapeTranscript(project.name, read.frame, read.live, items) : null,
            }
          : {}),
      },
    };
  }

  if (wanted) {
    const project = projects.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
    if (!project) {
      const available = projects.map((p) => p.name).sort((a, b) => a.localeCompare(b));
      return {
        status: 404,
        body: {
          error: "project not found",
          detail: `No project named "${wanted}". Projects you can read: ${available.join(", ") || "none yet"}.`,
          available,
        },
      };
    }
    const run = await getLatestRunForProjectKey(userId, project.name);
    const { row, tab, channel } = await rowFor(userId, project, run, presence, true);
    const read = await readTranscript(userId, tab, channel);
    return {
      status: 200,
      body: {
        ok: true,
        generatedAt,
        builders,
        sessions: [row],
        transcript: read
          ? shapeTranscript(project.name, read.frame, read.live, items ?? SESSIONS_DEFAULT_ITEMS)
          : null,
      },
    };
  }

  // The list never reaches GitHub or spends the owner's budget: ownerView
  // is off, so each row is the run's own facts and its cached ledger.
  const rows = await Promise.all(
    projects.map(async (project) => {
      const latest = await getLatestRunForProjectKey(userId, project.name).catch(() => null);
      return (await rowFor(userId, project, latest, presence, false)).row;
    }),
  );
  // At most SESSIONS_MAX_PROJECTS rows, what needs the person first; `total`
  // says how many there were, so a cut list is never read as the whole one.
  return {
    status: 200,
    body: {
      ok: true,
      generatedAt,
      builders,
      total: rows.length,
      sessions: orderSessions(rows).slice(0, SESSIONS_MAX_PROJECTS),
    },
  };
}
