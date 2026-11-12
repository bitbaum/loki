import type { RunFollow, RunHandoff } from "@/lib/run-handoff";
import type { RunTrack } from "@/lib/run-track";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import type { StatusTone, BuilderChannel } from "@/lib/constants/statuses";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { AGENT_LABELS } from "@/lib/agent-labels";
import { BUILDER_UPDATING_LABEL, BUILDER_UPDATING_SENTENCE } from "@/lib/runner-update-hold";
import { RUN_IDLE_RELEASE_MINUTES } from "@/lib/run-progress";

export type DispatchStatusInput = {
  ok?: boolean;
  mode?: string | null;
  warning?: string | null;
  runnerConnected?: boolean | null;
  /**
   * Which builder took it. Optional because older persisted messages predate
   * routing being recorded — those still render the unnamed copy rather than
   * guessing a machine they were never dispatched to.
   */
  channel?: BuilderChannel | null;
  /** The builder the project prefers was offline, so `channel` took the work. */
  reroutedFrom?: BuilderChannel | null;
  /** The cloud runner is behind the deploy, so this waits for its restart,
   *  for a bounded time (lib/runner-update-hold). */
  builderUpdating?: boolean | null;
  /** The project has an open run, and this one waits behind it in the same
   *  session (orchestration/busy-placement "queue"). */
  queuedBehind?: boolean | null;
};

/**
 * What a person is told when their task waits behind the project's open run.
 * It read "a runner is online and will claim it shortly" while the task
 * could wait for hours: the claim gate holds a project's next command until
 * its older run has closed. One wording for the chat, the API answer and the
 * run's track.
 */
export const QUEUED_BEHIND_SENTENCE =
  "This project is still on an earlier task. Yours is next in line and starts when that one ends. To start it now, open the project's session and send it there, or stop the earlier task.";

/** The same fact as a short label under a sent task. */
export const QUEUED_BEHIND_LABEL = "Next in line — starts when the earlier task ends";

/** The run a queued task waits behind, as the queue knows it (findQueueBlockers). */
export type QueueBlockerFacts = {
  label: string | null;
  startedAt: Date | string;
  lastProgressAt: Date | string | null;
};

const ZURICH_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
});
const ZURICH_DAY_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** A time a person reads: Zurich, with the day when it is not within the last 20 hours. */
export function zurichClock(at: Date | string, now: Date = new Date()): string {
  const d = new Date(at);
  return now.getTime() - d.getTime() > 20 * 60 * 60_000
    ? ZURICH_DAY_CLOCK.format(d)
    : ZURICH_CLOCK.format(d);
}

/**
 * What a task queued behind the project's open run waits on, and since when.
 *
 * "This project is still on an earlier task" was the whole answer, so two
 * orangecat prompts read Queued for over an hour behind a session that had
 * been idle since 06:17 (2026-11-12) and nobody could tell from the answer.
 * Now it names the run, when it opened, when its agent last printed work, and
 * the rule that ends the wait (lib/run-progress RUN_IDLE_RELEASE_MINUTES).
 * Without the facts, the general sentence.
 */
export function queuedBehindSentence(
  blocker: QueueBlockerFacts | null | undefined,
  now: Date = new Date(),
): string {
  if (!blocker) return QUEUED_BEHIND_SENTENCE;
  const what = blocker.label ? `“${blocker.label}”` : "an earlier task";
  const heard = blocker.lastProgressAt
    ? `; its agent last printed work at ${zurichClock(blocker.lastProgressAt, now)}`
    : "";
  return (
    `This project is still on ${what}, open since ${zurichClock(blocker.startedAt, now)}${heard}. ` +
    `Yours is next in line: it starts when that one ends, or once that session has printed no work for ${RUN_IDLE_RELEASE_MINUTES} minutes. ` +
    "To start it now, open the project's session and send it there, or stop the earlier task."
  );
}

/** The short label for the same fact. */
export function queuedBehindLabel(
  blocker: QueueBlockerFacts | null | undefined,
  now: Date = new Date(),
): string {
  if (!blocker) return "Next in line for this project";
  const what = blocker.label ? `“${blocker.label}”` : "an earlier task";
  return `Next in line, behind ${what} (open since ${zurichClock(blocker.startedAt, now)})`;
}

/**
 * The builder named for a sentence, or null when we genuinely don't know.
 *
 * Never guess. A label that names the wrong machine is worse than one that
 * names none: the operator goes looking for their work on a computer that
 * never had it.
 */
function builderName(channel: BuilderChannel | null | undefined): string | null {
  return channel ? (EXECUTOR_COPY.ranOn[channel] ?? null) : null;
}

/** SSOT for dispatch outcome copy — Loki footer, Control toasts, etc. */
export function dispatchStatusLabel(input: DispatchStatusInput): { label: string; warn: boolean } {
  if (input.ok === false) {
    return { label: "Dispatch failed", warn: true };
  }
  const on = builderName(input.channel);
  if (
    input.warning === "runner-offline" ||
    (input.mode === "queued" && input.runnerConnected === false)
  ) {
    // The most valuable place to name the builder: this says WHY nothing is
    // happening and which machine to wake, instead of a generic "offline".
    return {
      label: on ? `Queued for ${on} — runs when it's online` : EXECUTOR_COPY.queuedWhenOffline,
      warn: true,
    };
  }
  if (input.mode === "direct") {
    return { label: on ? `Running now on ${on}` : "Running now", warn: false };
  }
  if (input.mode === "queued" && input.queuedBehind) {
    return { label: QUEUED_BEHIND_LABEL, warn: false };
  }
  if (input.mode === "queued" && input.builderUpdating) {
    return { label: BUILDER_UPDATING_LABEL, warn: false };
  }
  if (input.mode === "queued") {
    const from = builderName(input.reroutedFrom);
    return {
      label:
        on && from
          ? `With ${on} — ${from} is offline`
          : on
            ? `With ${on} — starting shortly`
            : EXECUTOR_COPY.queuedWithBuilderOnline,
      warn: false,
    };
  }
  return { label: on ? `Dispatched to ${on}` : "Dispatched", warn: false };
}

export function dispatchAssistantContent(projectKey: string, input: DispatchStatusInput): string {
  if (input.ok === false) {
    return `Could not dispatch to ${projectKey}.`;
  }
  const { label, warn } = dispatchStatusLabel(input);
  const on = builderName(input.channel);
  if (input.mode === "direct") {
    return on
      ? `Running on **${projectKey}** in the agent terminal on ${on} now.`
      : `Running on **${projectKey}** in the agent terminal now.`;
  }
  if (input.mode === "queued" && !warn && input.queuedBehind) {
    // Not "starting shortly" either: it waits for the run ahead of it.
    return `Sent **${projectKey}**${on ? ` to ${on}` : ""}. ${QUEUED_BEHIND_SENTENCE}`;
  }
  if (input.mode === "queued" && !warn && input.builderUpdating) {
    // Not "starting shortly": the runner holds new work until it has
    // restarted on the new code, and the person is told how long at most.
    return `Sent **${projectKey}** to the cloud runner. ${BUILDER_UPDATING_SENTENCE}`;
  }
  if (input.mode === "queued" && !warn) {
    const from = builderName(input.reroutedFrom);
    // Say what happened and that nothing is needed. The stored preference is
    // unchanged; the next dispatch asks the same question again.
    if (on && from) {
      return `Dispatched **${projectKey}** to ${on} — ${from} is offline, so ${on} took it. Nothing to do.`;
    }
    return on
      ? `Dispatched **${projectKey}** to ${on} — ${EXECUTOR_COPY.queuedWithBuilderOnlineLong}`
      : `Dispatched **${projectKey}** — ${EXECUTOR_COPY.queuedWithBuilderOnlineLong}`;
  }
  if (warn) {
    // The generic long line ends "(cloud or this computer)" — right when the
    // builder is unknown, a contradiction after naming one ("Queued for this
    // computer — … starts when a builder is online (cloud or this computer)").
    return on
      ? `Queued **${projectKey}** for ${on} — it starts as soon as ${on} is online. Nothing is lost while it waits.`
      : `Queued **${projectKey}** — ${EXECUTOR_COPY.queuedWhenOfflineLong}`;
  }
  void label;
  return `Dispatched **${projectKey}**.`;
}

/**
 * A dispatch that went to another builder because the project's own was
 * offline, said in one sentence for a caller with no card to draw (the API,
 * an MCP app). The chat already says it (dispatchReply); an API caller got
 * `reroutedFrom` and a channel and had to know what the pair meant, so a
 * project pinned to an offline computer looked like it simply ran on the
 * cloud. Null when nothing was rerouted.
 */
export function rerouteNotice(
  channel: BuilderChannel | null | undefined,
  reroutedFrom: BuilderChannel | null | undefined,
): string | null {
  if (!channel || !reroutedFrom || channel === reroutedFrom) return null;
  const from = EXECUTOR_COPY.builderFromOutside[reroutedFrom];
  const on = EXECUTOR_COPY.builderFromOutside[channel];
  if (!from || !on) return null;
  return `This project is set to run on ${from}, which is offline now, so ${on} took this one. The setting is unchanged.`;
}

/** The live lifecycle of a queued dispatch, derived from its pending_command
 *  row. Lets the transcript footer show the truth as it unfolds — queued →
 *  picked up → ran / failed — instead of freezing on the optimistic snapshot
 *  stamped at dispatch time. SSOT for both the status API and the footer. */
export type DispatchLiveStatus =
  | "queued"
  /** A builder has it; the agent has not shown the prompt yet. */
  | "starting"
  | "working"
  /** At a permission prompt that can be answered from Loki (lib/approvals). */
  | "waiting_approval"
  /** Stopped until a person acts; the track's sentence says on what. */
  | "needs_you"
  | "delivered"
  | "completed"
  | "partial"
  | "stopped"
  | "unconfirmed"
  | "failed";

export type CommandLiveInput = {
  claimedAt: string | Date | null;
  executedAt: string | Date | null;
  result: {
    ok?: boolean | null;
    verified?: boolean | null;
    warning?: string | null;
    error?: string | null;
  } | null;
  run?: {
    state: string;
    outcome: string | null;
    payload?: { error?: string } | null;
  } | null;
};

export type DispatchLiveView = {
  status: DispatchLiveStatus;
  label: string;
  detail: string | null;
  tone: StatusTone;
  /** true once the command reached a settled state — the footer stops polling. */
  terminal: boolean;
  /** The finished run's own summary, in the chat's terms (lib/run-handoff). */
  handoff?: RunHandoff | null;
  /** After the run: the change's way to the live site, and Loki's look at it. */
  follow?: RunFollow | null;
  /** Where the change is, during the run and after it — the same delivery
   *  track Watch draws (lib/run-track, loaded by lib/run-track-load). */
  track?: RunTrack | null;
};

/**
 * How long this has been going, in the shortest form that is still precise.
 *
 * Every non-terminal state used to read the same from one second in to twenty
 * minutes in — "waiting for a completion handoff", forever. Observed
 * 2026-09-18: a dispatch sat on that line for five minutes with no elapsed
 * time, no heartbeat and no log, and the only way to learn whether anything
 * had happened was to go and read `git log` in another window. A dead builder
 * and a busy one are the same sentence.
 *
 * Deliberately NOT a judgement. There is no measured baseline for how long a
 * run should take, so this says how long it HAS taken and lets the person
 * decide. Inventing "taking longer than usual" would be a claim nothing here
 * can back.
 */
export function elapsedLabel(since: string | Date | null, now: number = Date.now()): string | null {
  if (!since) return null;
  const started = since instanceof Date ? since.getTime() : Date.parse(since);
  if (!Number.isFinite(started)) return null;
  const secs = Math.floor((now - started) / 1000);
  if (secs < 0) return null;
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

/** `detail`, with the elapsed time appended when there is one to show. */
function withElapsed(detail: string, since: string | Date | null, now: number): string {
  const label = elapsedLabel(since, now);
  return label ? `${detail} · ${label}` : detail;
}

export function deriveDispatchLiveStatus(
  cmd: CommandLiveInput,
  now: number = Date.now(),
): DispatchLiveView {
  const r = cmd.result ?? {};
  // A run that is over is over, whatever became of its command: stopped by
  // the person, reaped, or closed as undelivered while the command still sat
  // unclaimed for an offline builder. Reading the row first answered "Queued"
  // for a closed run, and every caller polled it forever.
  const runOver =
    cmd.run != null &&
    cmd.run.state !== ORCH_STATE.WAITING &&
    cmd.run.state !== ORCH_STATE.RUNNING &&
    cmd.run.state !== ORCH_STATE.CLOSING;
  if (!cmd.executedAt && !runOver) {
    if (!cmd.claimedAt) {
      return {
        status: "queued",
        label: "Queued",
        detail: "waiting for a runner to pick it up",
        tone: "neutral",
        terminal: false,
      };
    }
    return {
      status: "working",
      label: "Agent picked up — working",
      detail: withElapsed("running your prompt now", cmd.claimedAt, now),
      tone: "positive",
      terminal: false,
    };
  }
  if (r.ok === false) {
    return {
      status: "failed",
      label: "Dispatch failed",
      detail: r.error ?? "the agent could not run",
      tone: "negative",
      terminal: true,
    };
  }
  if (r.verified === false) {
    return {
      status: "unconfirmed",
      label: "Delivered — not confirmed",
      detail: r.warning ?? "the agent hasn't confirmed it started generating",
      tone: "warning",
      terminal: true,
    };
  }

  const run = cmd.run;
  if (!run) {
    return {
      status: "delivered",
      label: "Delivered to agent",
      detail: "the runner confirmed the prompt was submitted",
      tone: "positive",
      terminal: true,
    };
  }

  if (run.state === ORCH_STATE.WAITING) {
    return {
      status: "delivered",
      label: "Delivered to agent",
      // "completion handoff" is the internal name for it; what a person needs
      // to know is that the agent has the work and has not reported back yet.
      detail: withElapsed("agent has it — no result reported back yet", cmd.executedAt, now),
      tone: "positive",
      terminal: false,
    };
  }
  if (run.state === ORCH_STATE.RUNNING || run.state === ORCH_STATE.CLOSING) {
    return {
      status: "working",
      label: run.state === ORCH_STATE.CLOSING ? "Agent is finishing" : "Agent is working",
      detail: withElapsed("still working", cmd.executedAt, now),
      tone: "positive",
      terminal: false,
    };
  }

  const error = run.payload?.error?.trim() || null;
  switch (run.outcome) {
    case "success":
      return {
        status: "completed",
        label: "Completed",
        detail: "successful outcome recorded",
        tone: "positive",
        terminal: true,
      };
    case "partial":
      return {
        status: "partial",
        label: "Finished with follow-up",
        detail: "the run recorded remaining work",
        tone: "warning",
        terminal: true,
      };
    case "user_abort":
      return {
        status: "stopped",
        label: "Stopped by you",
        detail: null,
        tone: "neutral",
        terminal: true,
      };
    case "hang":
      return {
        status: "failed",
        label: "Agent stopped responding",
        detail: error,
        tone: "negative",
        terminal: true,
      };
    case "timeout":
      return {
        status: "failed",
        label: "Run timed out",
        detail: error,
        tone: "negative",
        terminal: true,
      };
    case "unconfirmed":
      // Deliberately NOT "Run timed out": no agent was ever seen working on
      // this, so pointing the operator at the agent's runtime is a wild goose
      // chase. Equally deliberately not "never reached the agent" — the runner
      // says it injected, and could only fail to confirm. The useful fact is
      // that nothing ran and a retry is free.
      return {
        status: "failed",
        label: "Agent never started",
        detail:
          error ??
          "The prompt was injected but the agent was never seen picking it up. Nothing ran — safe to retry.",
        tone: "negative",
        terminal: true,
      };
    case "error":
      return {
        status: "failed",
        label: "Run failed",
        detail: error,
        tone: "negative",
        terminal: true,
      };
    default:
      return {
        status: "unconfirmed",
        label: "Run closed — outcome missing",
        detail: "check Activity for the recorded evidence",
        tone: "warning",
        terminal: true,
      };
  }
}

/**
 * A failed dispatch's reason, in the words of the person who sent it.
 *
 * The runner's detail is written for whoever administers the builder ("remove
 * any stale ~/.claude/.credentials.json and set CLAUDE_CODE_OAUTH_TOKEN").
 * The workbench showed none of it: a task sent from there on 2026-11-11 came
 * back as the two words "Dispatch failed" while the header still read "Waiting
 * for a runner", and the reason sat unread in this API's own response. A
 * signed-out agent is the one cause common enough to say plainly; anything
 * else is passed through as the runner wrote it, which still beats silence.
 */
export function dispatchFailureForPerson(detail: string | null | undefined): string | null {
  const text = detail?.trim();
  if (!text) return null;
  const signedOut = /^([a-z][\w-]*) is not authenticated/i.exec(text);
  if (signedOut) {
    const id = signedOut[1].toLowerCase();
    const name = (AGENT_LABELS as Record<string, string>)[id] ?? signedOut[1];
    return `${name} is signed out on the builder, so nothing ran and nothing is lost. Sign it in again there, or send this to another agent.`;
  }
  return text;
}

// ── Shared presentation helpers ───────────────────────────────────────────

/** SSOT for tone → dot class. Loki's transcript, Control's dispatch banner,
 *  and the terminal composer's status line all render the same four tones —
 *  this was three separate inline `Record<tone, string>` maps before. */
export function dispatchToneDotClass(tone: StatusTone): string {
  // `ui-dot` is the size and shape; the tone class is only a colour. All four
  // callers passed the tone alone, so the dot was a 0×0 span — the status line
  // under every dispatch began with an invisible indicator and a blank gap.
  switch (tone) {
    case "positive":
      return "ui-dot ui-dot-positive";
    case "warning":
      return "ui-dot ui-dot-warning";
    case "negative":
      return "ui-dot ui-dot-negative";
    default:
      return "ui-dot ui-dot-neutral";
  }
}

/** One project's outcome from a fan-out dispatch (loki/multi-dispatch.ts). */
export type MultiDispatchAttempt = {
  projectKey: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  mode?: string | null;
};

export type MultiDispatchView = {
  label: string;
  tone: StatusTone;
  /** First project that actually started — the one worth linking to. Null
   *  when nothing started, so the footer offers no "watch it" link to a
   *  session that was never touched. */
  primaryProject: string | null;
};

/**
 * Honest badge for a fan-out ("develop these 3 projects") dispatch.
 *
 * Before this, the footer badge fell through every branch of
 * dispatchStatusLabel (none of which understand `multiDispatch` meta) to the
 * generic, always-green "Dispatched" — so 0-of-3 started read identically to
 * 3-of-3 on the one thing a skimming user actually looks at (the colored
 * dot), even though the reply text right above it correctly said "Started: none".
 */
export function deriveMultiDispatchView(attempts: MultiDispatchAttempt[]): MultiDispatchView {
  const started = attempts.filter((a) => a.ok);
  const total = attempts.length;
  const primaryProject = started[0]?.projectKey ?? null;
  if (total === 0) {
    return { label: "Nothing to dispatch", tone: "neutral", primaryProject: null };
  }
  if (started.length === 0) {
    return {
      label: `Dispatch failed — 0 of ${total} started`,
      tone: "negative",
      primaryProject: null,
    };
  }
  if (started.length < total) {
    return {
      label: `Started ${started.length} of ${total} — ${total - started.length} skipped`,
      tone: "warning",
      primaryProject,
    };
  }
  return { label: `Started all ${total}`, tone: "positive", primaryProject };
}

/**
 * While a run is open, its status is the track's.
 *
 * The status routes derived a word from the command row (claimed, executed)
 * and the track derived a sentence from the run's events, and the two were
 * returned side by side. On 2026-11-12 one response said status "delivered"
 * and track.summary "Waiting for a runner to pick it up". The track reads the
 * evidence (who claimed it, whether the agent printed anything), so it wins:
 * every field of an open run's view comes from `track.live` and
 * `track.summary`.
 *
 * "Delivered to agent" is therefore never said about an open run on the
 * strength of a runner's ack alone. Until the agent has shown output after
 * the prompt, the run is Starting; once it has, it is Working.
 *
 * A settled view is left as it is: a refused or unconfirmed command and a
 * finished run are facts of their own, not a stage of the road.
 */
export function alignLiveViewWithTrack(
  view: DispatchLiveView,
  track: RunTrack | null | undefined,
  /** The command row: a runner holds it (claimed, not yet answered). */
  command?: { claimed: boolean; executed: boolean } | null,
): DispatchLiveView {
  if (view.terminal || !track?.live) return view;
  const detail = track.summary;
  // A runner has claimed the command and is starting the agent: it holds the
  // claim for the 20-35 s a launch and its checks take, and nothing can be
  // blocked or stalled before it answers. The track may not know yet (no run
  // event marks a claim), so the row's own evidence sets the floor.
  if (command?.claimed && !command.executed && track.live !== "working") {
    return {
      ...view,
      status: "starting",
      label: "Starting",
      detail: "A builder picked it up and is starting the agent.",
      tone: "neutral",
    };
  }
  switch (track.live) {
    case "queued":
      return { ...view, status: "queued", label: "Queued", detail, tone: "neutral" };
    case "starting":
      return { ...view, status: "starting", label: "Starting", detail, tone: "neutral" };
    case "waiting_approval":
      return {
        ...view,
        status: "waiting_approval",
        label: "Waiting for your approval",
        detail,
        tone: "warning",
      };
    case "needs_you":
      return { ...view, status: "needs_you", label: "Needs you", detail, tone: "warning" };
    case "working":
      return view.status === "working"
        ? view
        : { ...view, status: "working", label: "Agent is working", detail, tone: "positive" };
  }
}
