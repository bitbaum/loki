/**
 * What did the operator just SAY? The grammar of no-screen mode, kept pure
 * (no model, no network) so it is pinned by scripts/test/voice-commands.ts
 * and so the phone can run the same parser for the three commands it handles
 * itself (quiet, repeat, end) without a round trip.
 *
 * The grammar is deliberately explicit. A sentence that does not match one
 * of these shapes is a question for Loki — the same chat path as the Loki
 * page — and never a guess at an action. With the screen off there is no
 * confirmation dialog, so "approve" must mean approve and nothing else must.
 *
 * Project names are matched through lib/project-mention (slug ↔ spoken form,
 * "orange cat" finds `orangecat`), never by raw substring.
 */
import { projectMentionedIn } from "@/lib/project-mention";
import type { VoiceCommandKind } from "@/config/no-screen";

export type ApprovalTarget = { all: true } | { all: false; index: number | null };

export type VoiceCommand =
  | { kind: "status" | "waiting" | "failures" | "help" | "repeat" | "quiet" | "end" }
  | { kind: "pause" | "resume"; project: string | null }
  | { kind: "approve" | "reject"; target: ApprovalTarget }
  | { kind: "dispatch"; project: string; task: string }
  | { kind: "ask"; text: string };

export type { VoiceCommandKind };

/** Lowercase, no punctuation, single spaces, and without a leading "loki". */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' :-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey |ok |okay )?loki[,:]?\s*/, "");
}

const ORDINALS: Record<string, number> = {
  first: 0,
  "1st": 0,
  one: 0,
  second: 1,
  "2nd": 1,
  two: 1,
  third: 2,
  "3rd": 2,
  three: 2,
  fourth: 3,
  four: 3,
  fifth: 4,
  five: 4,
  sixth: 5,
  six: 5,
  seventh: 6,
  seven: 6,
  eighth: 7,
  eight: 7,
  ninth: 8,
  nine: 8,
  tenth: 9,
  ten: 9,
};

/** "the first one", "number two", "3", "all", "both" → which approval. */
export function parseApprovalTarget(rest: string): ApprovalTarget {
  const r = rest.trim();
  if (/\b(all|everything|every one|both|them all|all of them)\b/.test(r)) return { all: true };
  for (const word of r.split(" ")) {
    if (/^\d{1,2}$/.test(word)) return { all: false, index: Math.max(0, Number(word) - 1) };
    if (word in ORDINALS) return { all: false, index: ORDINALS[word] };
    // "approve the last one" is answered by the caller, who knows the count.
    if (word === "last") return { all: false, index: -1 };
  }
  return { all: false, index: null };
}

const END_RE =
  /^(?:(?:end|stop|exit|quit|close|leave)(?: the)?(?: no[ -]?screen(?: mode)?| voice(?: mode)?| session| this)|goodbye|good night|bye|that's all|that is all|i'm done|we're done)$/;
const QUIET_RE =
  /^(?:quiet|be quiet|hold on|hang on|wait|shh+|shush|never ?mind|silence|stop talking|stop|halt)$/;
const REPEAT_RE =
  /^(?:(?:say|read) (?:that|it) again|repeat(?: that)?|again|what|pardon|sorry what)$/;
const HELP_RE =
  /^(?:help|what can i say|what can you do|what do you understand|commands|how does this work|what are the commands)$/;
const STATUS_RE =
  /^(?:status|briefing|brief me|update|fleet status|report|what's (?:going on|happening|the status|up|new)|what is (?:going on|happening|the status)|how's (?:the fleet|everything|it going)|how is (?:the fleet|everything|it going)|where are we|anything new|give me (?:the |an? )?(?:status|briefing|update)|tell me what's going on)$/;
const WAITING_RE =
  /^(?:approvals?|what's waiting(?: on| for) me|what is waiting(?: on| for) me|anything (?:waiting|for me|waiting for me)|what needs me|what do you need from me|what's pending|read (?:the |my )?approvals|list (?:the |my )?approvals|anything (?:i need|that needs) (?:to )?(?:approve|decide))$/;
const FAILURES_RE =
  /^(?:what failed|what's failed|anything (?:failed|broken)|any (?:failures|errors)|what (?:broke|went wrong)|failures|errors|read (?:me )?the last (?:failure|error)|what was the last (?:failure|error)|last (?:failure|error))$/;
const APPROVE_RE = /^(?:yes[, ]+)?(?:approve|approved|accept|confirm|go ahead with|ok to)\b(.*)$/;
const REJECT_RE =
  /^(?:no[, ]+)?(?:reject|rejected|decline|deny|refuse|drop|don't do|do not do)\b(.*)$/;
const PAUSE_RE = /^(?:pause|halt|freeze|stop)\b(?: the)?\s*(.*)$/;
const RESUME_RE = /^(?:resume|unpause|continue|restart|start again|carry on)\b(?: the)?\s*(.*)$/;
/** The rest of "pause …" that means the whole fleet. */
const ALL_RE = /^(?:everything|all|the fleet|fleet|all projects|all work|work|it all|all of it|)$/;

/**
 * "tell heidi to fix the header" / "ask orangecat to run the tests" /
 * "dispatch to solon: add a vote" / "heidi: fix the header" / "on heidi, fix…".
 * The project half must name a registered project or it is not a dispatch.
 */
function parseDispatch(text: string, projects: string[]): VoiceCommand | null {
  const shapes: RegExp[] = [
    /^(?:tell|ask|have|get|let|make) (.+?) to (.+)$/,
    /^(?:dispatch|send|give)(?: this| that| it)?(?: to)? (.+?)[:,] (.+)$/,
    /^(?:dispatch|send|give)(?: this| that| it)?(?: to)? (.+?) (?:to )?(.+)$/,
    /^(?:on|for|in) (.+?)[:,] (.+)$/,
    /^(.+?): (.+)$/,
  ];
  for (const re of shapes) {
    const m = text.match(re);
    if (!m) continue;
    const project = projectMentionedIn(m[1], projects);
    // The head must be the project, not a sentence that happens to name it.
    if (!project || m[1].split(" ").length > 4) continue;
    const task = m[2].trim();
    if (task.length < 3) continue;
    return { kind: "dispatch", project, task };
  }
  return null;
}

export function parseVoiceCommand(raw: string, projects: string[] = []): VoiceCommand {
  const text = normalizeUtterance(raw);
  if (!text) return { kind: "ask", text: raw.trim() };

  if (END_RE.test(text)) return { kind: "end" };
  if (QUIET_RE.test(text)) return { kind: "quiet" };
  if (REPEAT_RE.test(text)) return { kind: "repeat" };
  if (HELP_RE.test(text)) return { kind: "help" };
  if (STATUS_RE.test(text)) return { kind: "status" };
  if (WAITING_RE.test(text)) return { kind: "waiting" };
  if (FAILURES_RE.test(text)) return { kind: "failures" };

  // Dispatch before approve/reject: "tell heidi to approve the design" is work
  // for heidi, not a decision here.
  const dispatch = parseDispatch(text, projects);
  if (dispatch) return dispatch;

  let m = text.match(APPROVE_RE);
  if (m) return { kind: "approve", target: parseApprovalTarget(m[1]) };
  m = text.match(REJECT_RE);
  if (m) return { kind: "reject", target: parseApprovalTarget(m[1]) };

  m = text.match(PAUSE_RE);
  if (m) {
    const rest = m[1].trim();
    if (ALL_RE.test(rest)) return { kind: "pause", project: null };
    const project = projectMentionedIn(rest, projects);
    if (project) return { kind: "pause", project };
  }
  m = text.match(RESUME_RE);
  if (m) {
    const rest = m[1].trim();
    if (ALL_RE.test(rest)) return { kind: "resume", project: null };
    const project = projectMentionedIn(rest, projects);
    if (project) return { kind: "resume", project };
  }

  return { kind: "ask", text: raw.trim() };
}

/** The three commands the phone answers without the server. */
export function isLocalVoiceCommand(kind: VoiceCommandKind): boolean {
  return kind === "quiet" || kind === "repeat" || kind === "end";
}
