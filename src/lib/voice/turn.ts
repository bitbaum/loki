/**
 * One spoken turn: a sentence in, a sentence out, and the fleet action in
 * between. The HTTP boundary (/api/voice/turn) is a thin wrapper; the Loki
 * page's "Talk" could call this in-process one day and get the same answers.
 *
 * Every action here reuses the seam the screen uses: decideAction is the
 * Approvals page's decision, injectPrompt is the composer's dispatch,
 * pause/resume are Control's buttons, askLoki is the chat. No-screen mode
 * adds a mouth and an ear; it does not add a second way to do anything.
 */
import { decideAction } from "@/lib/actions/decide-action";
import { injectPrompt } from "@/lib/inject-core";
import { pauseFleetProjects, resumeFleetProjects } from "@/lib/fleet-pause";
import { askLoki } from "@/lib/loki-core";
import type { ChatMessage } from "@/lib/agent/llm";
import { parseVoiceCommand, type ApprovalTarget, type VoiceCommand } from "@/lib/voice/commands";
import {
  composeBriefing,
  composeFailures,
  composeHelp,
  composeWaiting,
  count,
  excerptForSpeech,
  spoken,
  type FleetSnapshot,
} from "@/lib/voice/briefing";
import { loadFleetSnapshot } from "@/lib/voice/fleet-snapshot";

export type VoiceTurnResult = {
  kind: VoiceCommand["kind"];
  /** What to read aloud. Never empty: silence is a dead end with the eyes shut. */
  say: string;
  /** The fleet after the action, so the phone can announce what changed. */
  snapshot: FleetSnapshot;
};

function pickApprovals(
  s: FleetSnapshot,
  target: ApprovalTarget,
): FleetSnapshot["approvals"] | string {
  if (s.approvalsLocked)
    return "Approvals are locked behind your PIN. Unlock them on screen first.";
  if (s.approvals.length === 0) return "Nothing is waiting on you.";
  if (target.all) return s.approvals;
  if (target.index === null) {
    if (s.approvals.length === 1) return s.approvals;
    return `There are ${s.approvals.length}. Which one? Say "the first one", "number two", or "all".`;
  }
  const index = target.index === -1 ? s.approvals.length - 1 : target.index;
  const one = s.approvals[index];
  if (!one) return `There are only ${count(s.approvals.length, "thing", "things")} waiting.`;
  return [one];
}

async function decide(
  userId: string,
  s: FleetSnapshot,
  decision: "approve" | "reject",
  target: ApprovalTarget,
): Promise<string> {
  const picked = pickApprovals(s, target);
  if (typeof picked === "string") return picked;
  const done: string[] = [];
  const failed: string[] = [];
  for (const a of picked) {
    const outcome = await decideAction(userId, a.id, decision).catch(() => ({
      found: false as const,
    }));
    const title = excerptForSpeech(a.title, 100);
    if (!outcome.found) failed.push(title);
    else if (decision === "approve" && outcome.result?.error)
      failed.push(`${title} (${outcome.result.error})`);
    else done.push(title);
  }
  const verb = decision === "approve" ? "Approved" : "Rejected";
  const parts: string[] = [];
  if (done.length === 1) parts.push(`${verb}: ${done[0]}.`);
  else if (done.length > 1) parts.push(`${verb} ${count(done.length, "thing", "things")}.`);
  if (failed.length > 0) parts.push(`Couldn't ${decision}: ${failed.join("; ")}.`);
  return parts.join(" ");
}

export async function runVoiceTurn(
  userId: string,
  text: string,
  history: ChatMessage[] = [],
): Promise<VoiceTurnResult> {
  const before = await loadFleetSnapshot(userId);
  const cmd = parseVoiceCommand(text, before.projects);
  let say = "";

  switch (cmd.kind) {
    case "status":
      say = composeBriefing(before);
      break;
    case "waiting":
      say = composeWaiting(before);
      break;
    case "failures":
      say = composeFailures(before);
      break;
    case "help":
      say = composeHelp();
      break;
    case "approve":
    case "reject":
      say = await decide(userId, before, cmd.kind, cmd.target);
      break;
    case "dispatch": {
      const { status, body } = await injectPrompt(
        { tab: cmd.project, customPrompt: cmd.task, notifyOnClose: true },
        userId,
      );
      say =
        status < 400
          ? `Sent to ${spoken(cmd.project)}: ${excerptForSpeech(cmd.task, 120)}. I'll tell you when it finishes.`
          : `Couldn't start that on ${spoken(cmd.project)}: ${excerptForSpeech(String(body.error ?? "unknown error"), 120)}.`;
      break;
    }
    case "pause":
    case "resume": {
      const keys = cmd.project ? [cmd.project] : before.projects;
      const fn = cmd.kind === "pause" ? pauseFleetProjects : resumeFleetProjects;
      const result = await fn(userId, keys);
      const verb = cmd.kind === "pause" ? "Paused" : "Resumed";
      say =
        result.paused > 0
          ? `${verb} autopilot on ${cmd.project ? spoken(cmd.project) : count(result.paused, "project")}.`
          : `Nothing to ${cmd.kind}.`;
      break;
    }
    // The phone answers these itself; a server still answers sensibly if asked.
    case "quiet":
    case "repeat":
    case "end":
      say = "";
      break;
    case "ask": {
      const { status, body } = await askLoki(cmd.text, {
        sessionKey: `agent:main:web:voice:${userId}`,
        userId,
        history,
      });
      const answer = typeof body.text === "string" ? body.text.trim() : "";
      say =
        status < 400 && answer
          ? answer
          : `Loki didn't answer. ${excerptForSpeech(String(body.error ?? ""), 100)}`.trim();
      break;
    }
  }

  // Re-read after an action so the phone's next diff starts from the truth.
  const changed =
    cmd.kind === "approve" ||
    cmd.kind === "reject" ||
    cmd.kind === "dispatch" ||
    cmd.kind === "pause" ||
    cmd.kind === "resume";
  const snapshot = changed ? await loadFleetSnapshot(userId) : before;
  return { kind: cmd.kind, say, snapshot };
}
