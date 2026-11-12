/**
 * An agent's permission prompt, answered from Loki instead of the terminal.
 *
 * The runner already sees the prompt: it reads the bottom of the agent's
 * screen (lib/run-progress detectPermissionPrompt) and reports the run as
 * blocked on "permission" with the agent's own question. Until now that was
 * a sentence: "It is asking: …". Nobody could answer it without opening the
 * terminal, and cloud sessions sat on unanswered prompts for six minutes and
 * more (2026-11-12: an "Update Environment" request pending 04:59-05:05, then
 * denied; "Add Repo push" pending from 05:04; "Get Environment" from 05:11).
 *
 * Here the prompt becomes a thing with an id that can be listed and answered,
 * by a person in the UI or by an agent with its token, and every answer is
 * recorded (who, how, when). Pure: no database, no network.
 */

/** What a person or an agent may answer. */
export const APPROVAL_DECISIONS = ["allow_once", "allow_always", "deny"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  allow_once: "Allow once",
  allow_always: "Allow always for this rule",
  deny: "Deny",
};

/** The kind of question, read from the agent's own words. */
export type ApprovalKind = "tool" | "trust" | "plan" | "environment";

export function approvalKind(question: string): ApprovalKind {
  const q = question.toLowerCase();
  if (/\btrust\b/.test(q)) return "trust";
  if (/\bplan\b/.test(q)) return "plan";
  if (/\benvironment\b|\bnetwork\b|\bdomain\b|\bfetch\b/.test(q)) return "environment";
  return "tool";
}

/**
 * Which answers a question takes. A trust dialog has no "always" (its second
 * option exits the agent), so offering one would press the wrong key.
 */
export function approvalChoices(kind: ApprovalKind): ApprovalDecision[] {
  return kind === "trust" ? ["allow_once", "deny"] : ["allow_once", "allow_always", "deny"];
}

/** Agents whose prompts are numbered menus with "allow" first and "always" second. */
const NUMBERED_MENU_AGENTS = new Set(["claude", "gemini"]);

/**
 * The keys that answer the prompt, typed into the agent's terminal.
 *
 * Claude Code and Gemini CLI number their options: 1 is "Yes" / "Allow
 * once", 2 is "Yes, and don't ask again" / "Allow always". Escape cancels a
 * prompt in every agent CLI Loki runs, which is the one safe way to deny.
 * Null when this agent has no known key for that answer: the API refuses
 * rather than guess, and a person answers in the terminal.
 */
export function approvalKeys(
  decision: ApprovalDecision,
  agent: string | null | undefined,
  kind: ApprovalKind,
): string | null {
  if (!approvalChoices(kind).includes(decision)) return null;
  if (decision === "deny") return "\u001b";
  if (!agent || !NUMBERED_MENU_AGENTS.has(agent)) return null;
  return decision === "allow_once" ? "1" : "2";
}

/**
 * One prompt's id: the run and the question it asked. An answer names it, so
 * an answer meant for a question the agent has already moved past (or one it
 * asked since) is refused instead of pressing a key into the next prompt.
 */
export function approvalId(runId: string, question: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < question.length; i++) {
    h ^= question.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${runId}.${h.toString(16).padStart(8, "0")}`;
}

export function parseApprovalId(id: string): { runId: string; hash: string } | null {
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{8})$/i.exec(id);
  return m ? { runId: m[1].toLowerCase(), hash: m[2].toLowerCase() } : null;
}

/** "Waiting for your approval: <what>" with how long it has waited. */
export function approvalHeadline(question: string, since: string | Date | null, now = Date.now()) {
  const what = question.trim() || "permission to run a tool";
  if (!since) return `Waiting for your approval: ${what}`;
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  const waited = mins < 1 ? "just now" : mins === 1 ? "for 1 minute" : `for ${mins} minutes`;
  return `Waiting for your approval: ${what} (${waited === "just now" ? "asked just now" : `waiting ${waited}`})`;
}

/** A pending approval, as the API and the MCP tools return it. */
export type PendingApproval = {
  id: string;
  runId: string;
  tab: string;
  project: string;
  question: string;
  kind: ApprovalKind;
  choices: ApprovalDecision[];
  since: string | null;
  headline: string;
};
