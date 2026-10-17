/**
 * "Yes, do it" — a reply whose whole meaning is in Loki's previous answer.
 *
 * Found on the live site (2026-10-15): Loki suggested creating projects for a
 * podcast and some design work, and offered the reply button "Yes, create it".
 * Tapping it sent "Yes, create it" to the BAKERY — the only project — as a
 * build task, because "create" is an action verb and a sole project is enough
 * context for a bare instruction. The agent would have received three words
 * and no idea what "it" was.
 *
 * Two rules:
 * 1. A bare agreement never becomes work for whichever project happens to be
 *    selected. It is a reply in the conversation.
 * 2. When the answer it agrees with ended in the bold, ready-to-send line the
 *    prompt asks Loki for ("**create project night-shift**", "**bakery: add a
 *    menu page**"), agreeing sends THAT line — the same thing tapping it out
 *    by hand would have done.
 *
 * Pure: text in, decision out. The route decides what to run.
 */

/** Words that say "yes" — at least one must be present. */
const AGREE = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "ok",
  "okay",
  "sure",
  "please",
  "go",
  "ahead",
  "do",
  "sounds",
  "good",
  "great",
  "perfect",
  "fine",
  "lets",
  "agreed",
  "absolutely",
]);

/** Words that may accompany the "yes" without adding a task of their own. */
const FILLER = new Set([
  "it",
  "that",
  "this",
  "them",
  "those",
  "both",
  "all",
  "now",
  "then",
  "and",
  "for",
  "me",
  "us",
  "create",
  "build",
  "make",
  "start",
  "send",
  "add",
  "set",
  "up",
  "run",
  "with",
  "the",
  "one",
  "thanks",
  "thank",
  "you",
]);

const MAX_WORDS = 7;

export function isBareConfirmation(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return false;
  if (!words.some((w) => AGREE.has(w))) return false;
  return words.every((w) => AGREE.has(w) || FILLER.has(w));
}

/**
 * The ready-to-send line an answer ended with, if it ended with exactly one.
 *
 * Only a bold line on its own, at the end, shaped like a command Loki runs:
 * "create project …" or "<project>: <instruction>". Bold phrases inside a
 * sentence are emphasis, not offers. Two offered lines are a choice, and a
 * "yes" does not say which — the caller answers instead.
 */
export function offeredCommand(answer: string | null | undefined): string | null {
  if (!answer) return null;
  const lines = answer
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const offers: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\*\*(.+)\*\*[.!]?$/.exec(lines[i]);
    if (!m) break;
    const line = m[1].trim();
    if (!/^create (?:a )?(?:new )?project\b/i.test(line) && !/^[a-z0-9][\w.-]*:\s+\S/i.test(line)) {
      break;
    }
    // An offer only the person can carry out is not a command: "yes" to
    // "bakery: install the desktop app" must not send an agent to install it.
    if (isPersonOnlyStep(line)) break;
    offers.push(line);
  }
  return offers.length === 1 ? offers[0] : null;
}

/**
 * Steps an agent cannot take for the person: their machine, their accounts,
 * their keys, their money, their decision.
 *
 * Found on the live site (2026-10-17): an answer ended with the bold line
 * "**prodtest-bakery: install the Fleet Runner desktop app and connect it**" —
 * shaped exactly like a command, so "yes" would have sent a build agent off to
 * install software on the operator's own computer. The prompt already says the
 * line must be agent work; this is the check that does not depend on the model
 * listening.
 */
const PERSON_ONLY = [
  /\b(install|download)\b.*\b(fleet runner|desktop app|the app|extension|cli|on your (computer|machine|phone|laptop))\b/i,
  /\b(sign|log) (in|up|into)\b/i,
  /\bcreate (an|your) account\b/i,
  /\b(add|enter|paste|provide|give|share|set) (your|an|the|a) (own )?(api )?(key|token|password|credentials?|card)\b/i,
  /\b(verify|confirm) (your )?(e-?mail|address|phone|identity)\b/i,
  // Anchored: "approve the request" is theirs, "add a pay button" is a build.
  /^(approve|pay|buy|purchase|subscribe|top up)\b/i,
  /\b(restart|reconnect|reinstall|update) (the |your )?(fleet runner|desktop app|builder|runner)\b/i,
  /\b(decide|choose|pick) (whether|which|between|if)\b/i,
];

export function isPersonOnlyStep(line: string): boolean {
  const instruction = line.replace(/^[a-z0-9][\w.-]*:\s+/i, "");
  return PERSON_ONLY.some((re) => re.test(instruction));
}

/**
 * An answer that ended with a person-only step in command shape, rewritten as
 * the plain sentence it should have been: no bold, no project prefix, so it
 * reads as something for them to do and nothing offers to send it.
 */
export function demotePersonOnlyOffer(answer: string): string {
  const lines = answer.split(/\r?\n/);
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  if (i < 0) return answer;
  const m = /^(\s*)\*\*(.+)\*\*([.!]?)\s*$/.exec(lines[i]);
  if (!m) return answer;
  const line = m[2].trim();
  if (!/^[a-z0-9][\w.-]*:\s+\S/i.test(line) || !isPersonOnlyStep(line)) return answer;
  const step = line.replace(/^[a-z0-9][\w.-]*:\s+/i, "");
  const sentence = step.charAt(0).toUpperCase() + step.slice(1);
  lines[i] = `${m[1]}${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`}`;
  return lines.join("\n");
}
