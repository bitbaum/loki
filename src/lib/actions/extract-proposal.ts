/**
 * Action-queue PRODUCER — turn a user's chat message into a proposed draft action.
 *
 * The action queue had executors (Telegram/email/calendar/commitment) and an
 * approval UI, but almost nothing *created* actions — chat-Loki was pure
 * text-in/text-out. This is the missing mouth: a structured extraction pass that
 * detects when the operator asked Loki to DO something external and returns a
 * proposal the caller enqueues as `status='draft'` (IRON RULE: the operator still
 * approves every one before it executes).
 *
 * Model-agnostic by design: extraction runs on Groq JSON regardless of which
 * brain (OpenClaw gateway or Groq) answered the chat turn — the task is a narrow
 * classify-and-structure, independent of the conversational reply. Best-effort:
 * any failure (no key, timeout, bad JSON) simply yields null — "no proposal this
 * turn" — and never breaks the chat answer.
 *
 * Only the four *executable* action types are extracted (send_message, send_email,
 * create_event, create_commitment). FOLLOW_UP / OTHER are deferred no-ops, so
 * proposing them would only queue dead drafts.
 */
import { usableChatChain } from "@/config/chat-models";
import { z } from "zod";
import { callGroqText, GROQ_FAST_MODEL } from "@/lib/groq";
import { ACTION_TYPE, type ActionType } from "@/lib/constants/statuses";
import type { ActionPayload } from "@/db/schema/actions";

export type ExtractedProposal = {
  type: ActionType;
  title: string;
  description?: string;
  payload?: ActionPayload;
  reasoning?: string;
};

// The types a chat message can produce — only those with a real, wired executor.
const EXTRACTABLE_TYPES = [
  ACTION_TYPE.SEND_MESSAGE,
  ACTION_TYPE.SEND_EMAIL,
  ACTION_TYPE.CREATE_EVENT,
  ACTION_TYPE.CREATE_COMMITMENT,
] as const;

// Validation is the safety boundary — the model's JSON is untrusted input. We
// keep payload permissive (the executors are lenient and re-validate their own
// fields) but pin type/title so a malformed extraction can't enqueue garbage.
const ProposalSchema = z.object({
  actionable: z.boolean(),
  type: z.enum(EXTRACTABLE_TYPES as unknown as [string, ...string[]]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  reasoning: z.string().trim().max(2000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Pure parse + validate of the model's raw output. Exported so the bug-prone
 * part (fence-stripping, JSON.parse, schema pinning) is unit-testable without I/O.
 * Returns null for non-actionable, malformed, or incomplete proposals.
 */
export function parseProposalJson(raw: string): ExtractedProposal | null {
  if (!raw) return null;
  // Models often wrap JSON in ```json fences or add a prose preamble; grab the
  // outermost {...} span and parse that.
  const fenced = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }

  const parsed = ProposalSchema.safeParse(obj);
  if (!parsed.success) return null;
  const p = parsed.data;
  // Actionable requires the concrete fields; anything missing = treat as not
  // actionable (fail closed — never enqueue a half-specified draft).
  if (!p.actionable || !p.type || !p.title) return null;

  return {
    type: p.type as ActionType,
    title: p.title,
    description: p.description,
    reasoning: p.reasoning,
    payload: p.payload as ActionPayload | undefined,
  };
}

const SYSTEM_PROMPT = `You extract ACTION PROPOSALS from a builder's message to their assistant.
Decide if the message is a concrete request to take an EXTERNAL action on the user's behalf. Only these four actions count:
- "send_message": send a Telegram/WhatsApp message to someone. payload: { to, channel: "telegram"|"whatsapp", body }
- "send_email": send an email. payload: { to, subject, body }
- "create_event": book a calendar event. payload: { eventTitle, eventStart (RFC3339) and eventEnd, OR eventDate ("YYYY-MM-DD" for all-day), eventLocation? }
- "create_commitment": record a personal commitment/todo with a due date. payload: { commitment, dueDate ("YYYY-MM-DD") }

Respond with ONE JSON object, nothing else.
If it is NOT a concrete request to do one of those four (e.g. a question, a status check, planning, chit-chat, or asking the assistant to explain something): {"actionable": false}
If it IS: {"actionable": true, "type": "<one of the four>", "title": "<short imperative label, <=80 chars>", "description": "<one line>", "payload": { ...fields for that type... }, "reasoning": "<why, one line>"}

Rules:
- Resolve relative dates/times against the provided current time; output absolute values only.
- Never invent a recipient, address, or detail the user did not give — omit unknown fields.
- Prefer NOT actionable when unsure. A single wrong queued draft costs the user a click; a false positive on every question is noise.`;

/**
 * Extract a proposal from the raw user message. `nowISO` anchors relative dates
 * (the caller passes new Date().toISOString() — this module stays clock-free so
 * it's deterministically testable). Returns null when nothing should be queued.
 */
export async function extractActionProposal(
  userMessage: string,
  nowISO: string,
): Promise<ExtractedProposal | null> {
  const text = userMessage.trim();
  if (!text) return null;
  // The call walks the whole free chain; with no usable link it is a no-op.
  if (usableChatChain().length === 0) return null;

  const raw = await callGroqText(`Current time: ${nowISO}\n\nMessage:\n${text}`, {
    feature: "proposal-extract",
    systemPrompt: SYSTEM_PROMPT,
    model: GROQ_FAST_MODEL,
    maxTokens: 300,
    temperature: 0,
    timeoutMs: 8_000,
  });
  return parseProposalJson(raw);
}

// ── Inline self-test (pure parse/validate — the bug-prone part) ───────────────
// Run with: npx tsx src/lib/actions/extract-proposal.ts --self-test
function selfTest(): void {
  let pass = 0;
  const cases: Array<[string, boolean]> = [];
  const check = (name: string, cond: boolean) => {
    cases.push([name, cond]);
    if (cond) pass++;
  };

  check("not actionable ⇒ null", parseProposalJson('{"actionable": false}') === null);

  const msg = parseProposalJson(
    '{"actionable": true, "type": "send_message", "title": "Message Anna", "payload": {"to": "Anna", "channel": "telegram", "body": "running late"}}',
  );
  check("send_message parsed", msg?.type === "send_message" && msg?.title === "Message Anna");
  check("send_message payload preserved", (msg?.payload?.body as string) === "running late");

  check(
    "code-fenced JSON parsed",
    parseProposalJson(
      '```json\n{"actionable": true, "type": "send_email", "title": "Email bank"}\n```',
    )?.type === "send_email",
  );

  check(
    "prose preamble tolerated",
    parseProposalJson(
      'Sure! Here you go:\n{"actionable": true, "type": "create_commitment", "title": "Call dentist"}',
    )?.title === "Call dentist",
  );

  // Fail-closed: actionable but missing type/title ⇒ null.
  check(
    "actionable w/o type ⇒ null",
    parseProposalJson('{"actionable": true, "title": "x"}') === null,
  );
  check(
    "actionable w/o title ⇒ null",
    parseProposalJson('{"actionable": true, "type": "send_email"}') === null,
  );

  // Unwired/deferred type is not in the enum ⇒ rejected.
  check(
    "non-extractable type ⇒ null",
    parseProposalJson('{"actionable": true, "type": "other", "title": "x"}') === null,
  );

  // Garbage / no JSON ⇒ null, never throws.
  check("empty ⇒ null", parseProposalJson("") === null);
  check("no json ⇒ null", parseProposalJson("I can't do that.") === null);
  check("broken json ⇒ null", parseProposalJson('{"actionable": true, "type":') === null);

  // Title length guard.
  check(
    "overlong title ⇒ null",
    parseProposalJson(
      `{"actionable": true, "type": "send_email", "title": "${"x".repeat(201)}"}`,
    ) === null,
  );

  const evt = parseProposalJson(
    '{"actionable": true, "type": "create_event", "title": "Team sync", "payload": {"eventDate": "2026-07-20", "eventLocation": "Zurich"}}',
  );
  check("create_event date payload", (evt?.payload?.eventDate as string) === "2026-07-20");

  for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
  const total = cases.length;
  if (pass !== total) {
    console.error(`\n${pass}/${total} passed`);
    process.exit(1);
  }
  console.log(`\n${pass}/${total} passed`);
}

const isDirectCli = process.argv[1]?.endsWith("extract-proposal.ts");
if (isDirectCli && process.argv.includes("--self-test")) selfTest();
