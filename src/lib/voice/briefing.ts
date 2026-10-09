/**
 * The fleet, as SENTENCES. Everything no-screen mode says about the fleet is
 * composed here from one snapshot, so the briefing, the approval list, the
 * failure list and the announcements between turns all describe the same
 * truth in the same words. Pure: pinned by scripts/test/voice-briefing.ts.
 *
 * Rules for speech, learned from reading the Control page aloud:
 *   - Numbers under eleven are words; a voice reads "2 agents" as "two agents"
 *     anyway, but "0 agents" comes out as "zero agents", which nobody says.
 *   - Lead with what needs the person. Idle projects are never listed.
 *   - One sentence per fact. A spoken paragraph cannot be skimmed.
 *   - Say "nothing" when there is nothing; silence is indistinguishable from
 *     a dead microphone.
 */
import { NO_SCREEN_COMMANDS, NO_SCREEN_MAX_ANNOUNCEMENTS } from "@/config/no-screen";
import { plainTextForSpeech } from "@/lib/loki/speech-text";
import type { FleetChange } from "@/lib/voice/announce";

export type FleetSnapshot = {
  /** ISO time the snapshot was taken. */
  at: string;
  /** null = the server could not tell. */
  builderOnline: boolean | null;
  /** Registered project names, for the parser. */
  projects: string[];
  /** Agents with an open turn right now. */
  working: { project: string; sinceMin: number }[];
  /** Runs queued behind an absent builder. */
  waitingForBuilder: { project: string; sinceMin: number }[];
  /** Runs that ended recently, newest first. */
  recentRuns: {
    id: string;
    project: string;
    failed: boolean;
    finishedAt: string | null;
    /** What the agent said it did, or the error, as stored. */
    note: string | null;
  }[];
  alerts: { id: string; title: string; severity: string }[];
  /** Open drafts awaiting the operator's word; empty while locked. */
  approvals: { id: string; title: string; type: string }[];
  /** The private-zone PIN is set and not entered on this device. */
  approvalsLocked: boolean;
};

const SMALL = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const ORDINAL = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
];

/** "one run", "three runs", "no runs". */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  const word = n >= 0 && n < SMALL.length ? SMALL[n] : String(n);
  return `${word} ${n === 1 ? noun : plural}`;
}

/** "a, b and c". */
export function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function since(min: number): string {
  if (min < 1) return "just now";
  if (min < 60) return `for ${count(min, "minute")}`;
  const h = Math.round(min / 60);
  return `for ${count(h, "hour")}`;
}

/** Stored text, flattened for a voice and cut at a sentence end. */
export function excerptForSpeech(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  const plain = plainTextForSpeech(text).replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "));
  return (end > max / 2 ? cut.slice(0, end + 1) : cut).trim();
}

/** Spoken name: slugs read better with their separators as spaces. */
export function spoken(project: string): string {
  return project.replace(/[-_]+/g, " ");
}

export function composeBriefing(s: FleetSnapshot): string {
  const lines: string[] = [];

  if (s.builderOnline === false) lines.push("The builder is offline, so nothing can run.");
  else if (s.builderOnline === null) lines.push("I can't tell whether the builder is online.");

  if (s.working.length > 0) {
    const who = s.working.map((w) => `${spoken(w.project)} ${since(w.sinceMin)}`);
    lines.push(`${count(s.working.length, "agent is", "agents are")} working: ${list(who)}.`);
  } else {
    lines.push("Nobody is working right now.");
  }

  if (s.waitingForBuilder.length > 0) {
    lines.push(
      `${count(s.waitingForBuilder.length, "run is", "runs are")} waiting for a builder: ${list(
        s.waitingForBuilder.map((w) => spoken(w.project)),
      )}.`,
    );
  }

  if (s.approvalsLocked) {
    lines.push("Approvals are locked behind your PIN. Unlock them on screen to hear them.");
  } else if (s.approvals.length > 0) {
    lines.push(
      `${count(s.approvals.length, "thing is", "things are")} waiting on you. Say "what's waiting" to hear them.`,
    );
  }

  const failed = s.recentRuns.filter((r) => r.failed);
  if (failed.length > 0) {
    lines.push(
      `${count(failed.length, "run")} failed: ${list(failed.map((r) => spoken(r.project)))}. Say "what failed" for the errors.`,
    );
  }

  if (s.alerts.length > 0) {
    lines.push(
      `${count(s.alerts.length, "alert is", "alerts are")} open: ${list(s.alerts.map((a) => excerptForSpeech(a.title, 80)))}.`,
    );
  }

  const quiet =
    s.working.length === 0 &&
    s.waitingForBuilder.length === 0 &&
    s.approvals.length === 0 &&
    !s.approvalsLocked &&
    failed.length === 0 &&
    s.alerts.length === 0 &&
    s.builderOnline !== false;
  if (quiet) return "All quiet. Nothing is running and nothing is waiting on you.";
  return lines.join(" ");
}

export function composeWaiting(s: FleetSnapshot): string {
  if (s.approvalsLocked)
    return "Approvals are locked behind your PIN. Unlock them on screen, then ask again.";
  if (s.approvals.length === 0) return "Nothing is waiting on you.";
  const items = s.approvals
    .slice(0, ORDINAL.length)
    .map((a, i) => `${ORDINAL[i]}: ${excerptForSpeech(a.title, 120)}.`);
  const more =
    s.approvals.length > ORDINAL.length ? ` And ${s.approvals.length - ORDINAL.length} more.` : "";
  return `${count(s.approvals.length, "thing", "things")}. ${items.join(" ")}${more} Say "approve the first one", "reject number two", or "approve all".`;
}

export function composeFailures(s: FleetSnapshot): string {
  const failed = s.recentRuns.filter((r) => r.failed).slice(0, 3);
  if (failed.length === 0) return "Nothing failed today.";
  const items = failed.map((r) => {
    const why = excerptForSpeech(r.note, 200);
    return `${spoken(r.project)}: ${why || "no error was recorded"}.`;
  });
  return `${count(failed.length, "failure")}. ${items.join(" ")}`;
}

export function composeHelp(): string {
  const phrases = NO_SCREEN_COMMANDS.map((c) => c.say[0].replace(/[?.]$/, ""));
  return `You can say: ${phrases.join(". ")}. Anything else, I answer as Loki.`;
}

/**
 * What changed between two snapshots, as typed changes. Finished runs, new
 * approvals, the builder dropping or returning, new alerts, a project
 * starting work. Projects going idle are not a change: a run's own ending
 * already says that. The SENTENCES are lib/voice/announce.ts's job — this
 * only decides what is new. Bounded, so a phone reconnecting after an hour
 * does not read out sixty runs.
 */
export function diffSnapshots(prev: FleetSnapshot, next: FleetSnapshot): FleetChange[] {
  const out: FleetChange[] = [];

  if (prev.builderOnline !== false && next.builderOnline === false)
    out.push({ kind: "builder-offline" });
  if (prev.builderOnline === false && next.builderOnline === true)
    out.push({ kind: "builder-online" });

  const seenRuns = new Set(prev.recentRuns.map((r) => r.id));
  for (const r of next.recentRuns) {
    if (seenRuns.has(r.id)) continue;
    out.push(
      r.failed
        ? { kind: "failed", project: r.project, note: r.note }
        : { kind: "finished", project: r.project, note: r.note },
    );
  }

  const seenApprovals = new Set(prev.approvals.map((a) => a.id));
  for (const a of next.approvals)
    if (!seenApprovals.has(a.id)) out.push({ kind: "approval", id: a.id, title: a.title });

  const seenAlerts = new Set(prev.alerts.map((a) => a.id));
  for (const a of next.alerts)
    if (!seenAlerts.has(a.id)) out.push({ kind: "alert", title: a.title });

  const wasWorking = new Set(prev.working.map((w) => w.project));
  for (const w of next.working)
    if (!wasWorking.has(w.project)) out.push({ kind: "started", project: w.project });

  return out.slice(0, NO_SCREEN_MAX_ANNOUNCEMENTS);
}
