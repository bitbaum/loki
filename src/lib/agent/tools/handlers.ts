/**
 * Loki's tools — reads over Loki's OWN tables, and two proposal paths.
 *
 * Every read tool is a thin wrapper over an adapter in `src/lib/agent/sources*`
 * — the SAME adapter the seed builder calls. That is the rule, not a
 * convenience: a source reachable only by tool call is invisible on every turn
 * where the tool loop cannot run (rate-limited, or the prompt too big for the
 * vendor's window), and production served exactly that twice. The seed gives
 * survivability; the tool adds depth (a filter, a name, a wider window).
 *
 * Every handler returns `Fact[]` built with `makeFact`, so unstored fields
 * render as `<not recorded>` and the verifier can check the answer against
 * them. No handler formats prose; see tools/registry.ts for why that invariant
 * is load-bearing rather than stylistic.
 *
 * Handlers do not throw for "nothing found" — an empty result with a `note` is
 * a real, reportable answer ("no people matched") and materially different from
 * an error. Collapsing those two was how the old context let the model treat a
 * gap as an invitation.
 */
import { z } from "zod";
import { enqueueAction } from "@/lib/actions/enqueue-action";
import { listCrew } from "@/db/queries/crew";
import { createHumanTask } from "@/db/queries/human-tasks";
import { TASK_ACTOR } from "@/config/crew";
import { ACTION_TYPE, type ActionType, type FeedbackStatus } from "@/lib/constants/statuses";
import { ORCHESTRATION_STATES, type OrchestrationState } from "@/lib/orchestration/contract";
import { HOUR_MS } from "@/lib/constants/time";
import { askGatewayAgent, isGatewayConfigured } from "@/lib/openclaw-gateway";
import { makeFact } from "@bitbaum/ai-kit/grounding";
import {
  alertFacts,
  captureFacts,
  commitmentFacts,
  crewFacts,
  documentFacts,
  feedbackFacts,
  fleetStatusFacts,
  goalFacts,
  habitFacts,
  humanTaskFacts,
  pendingApprovalFacts,
  peopleFacts,
  projectFacts,
  runFacts,
  sessionFacts,
} from "@/lib/agent/sources";
import { enrichReachPayload, reachFromPerson, resolvePersonToReach } from "@/lib/people-resolve";
import { defineTool } from "@/lib/agent/tools/registry";
import type { ToolRegistry, ToolResult } from "@/lib/agent/tools/registry";

const LIST_LIMIT = 12;

/** Empty-but-successful result. The note makes "none" legible as an answer. */
function empty(note: string): ToolResult {
  return { facts: [], note };
}

const searchPeopleTool = defineTool({
  name: "search_people",
  kind: "read",
  description:
    "Look up the operator's contacts by name, alias, email, or phone. Returns only stored fields — company, title, location, channels, notes when present. Never invent a job or affiliation.",
  params: z.object({
    query: z.string().max(80).describe("name fragment, or empty for recent contacts"),
  }),
  example: 'TOOL: search_people\nARGS: {"query": "Elena"}',
  handler: async ({ query }, ctx) => {
    const facts = await peopleFacts(ctx.userId, String(query ?? ""));
    return facts.length > 0
      ? { facts }
      : empty(`No contact matched "${query}". The operator's contact list has no such entry.`);
  },
});

const searchProjectsTool = defineTool({
  name: "list_projects",
  kind: "read",
  description:
    "List the operator's registered projects with stack, status and latest dev-log line.",
  params: z.object({}),
  example: "TOOL: list_projects\nARGS: {}",
  handler: async (_args, ctx) => {
    // The tool takes no arguments, so the operator's message is the only signal
    // available for ranking — and this list is capped, so which projects survive
    // the cap matters. Same ranking the seed uses, for the same reason.
    const facts = await projectFacts(ctx.userId, ctx.message);
    return facts.length > 0 ? { facts } : empty("The operator has no registered projects.");
  },
});

const searchKnowledgeTool = defineTool({
  name: "search_knowledge",
  kind: "read",
  description:
    "Semantic search over project dossiers, dev logs, repo docs and essays. Use for 'what did I decide about X' or 'how does Y work'. Returns excerpts — evidence that something was WRITTEN, not proof it is still true.",
  params: z.object({ query: z.string().min(2).max(200) }),
  example: 'TOOL: search_knowledge\nARGS: {"query": "why did we choose pgvector"}',
  handler: async ({ query }, ctx) => {
    const facts = await documentFacts(ctx.userId, String(query), 6);
    return facts.length > 0
      ? { facts }
      : empty(`Nothing in the knowledge index matched "${query}".`);
  },
});

const listGoalsTool = defineTool({
  name: "list_goals",
  kind: "read",
  description: "The operator's active goals with progress and target date.",
  params: z.object({}),
  example: "TOOL: list_goals\nARGS: {}",
  handler: async (_args, ctx) => {
    const facts = await goalFacts(ctx.userId, LIST_LIMIT);
    return facts.length > 0 ? { facts } : empty("The operator has no active goals.");
  },
});

const listHabitsTool = defineTool({
  name: "list_habits",
  kind: "read",
  description: "The operator's habits with today's check-off state and current streak.",
  params: z.object({}),
  example: "TOOL: list_habits\nARGS: {}",
  handler: async (_args, ctx) => {
    const facts = await habitFacts(ctx.userId, LIST_LIMIT);
    return facts.length > 0 ? { facts } : empty("The operator tracks no habits.");
  },
});

const listCommitmentsTool = defineTool({
  name: "list_commitments",
  kind: "read",
  description: "Commitments and deadlines coming up. Give a day window.",
  params: z.object({ days: z.number().int().min(1).max(90).optional() }),
  example: 'TOOL: list_commitments\nARGS: {"days": 7}',
  handler: async ({ days }, ctx) => {
    const window = typeof days === "number" ? days : 14;
    const facts = await commitmentFacts(ctx.userId, window);
    return facts.length > 0
      ? { facts }
      : empty(`Nothing due in the next ${window} days — the query ran and matched nothing.`);
  },
});

const listPendingApprovalsTool = defineTool({
  name: "list_pending_approvals",
  kind: "read",
  description:
    "The operator's approval queue — draft actions waiting for their approve/reject. Use when asked what is pending, waiting, or needs a decision. Decisions happen on the Approvals page, not here.",
  params: z.object({}),
  example: "TOOL: list_pending_approvals\nARGS: {}",
  handler: async (_args, ctx) => {
    const facts = await pendingApprovalFacts(ctx.userId, LIST_LIMIT);
    if (facts.length === 0)
      return empty("The approval queue is empty — nothing is waiting for the operator.");
    return { facts };
  },
});

/**
 * Visitor feedback — what people reported through the widget on the
 * operator's sites, and what happened to each report.
 */
const listFeedbackTool = defineTool({
  name: "list_feedback",
  kind: "read",
  description:
    "Visitor feedback reports filed through the feedback widget, newest first. Filter by status (new, dispatched, resolved, archived) or project name. Use for 'what feedback came in', 'was my report received', 'what did visitors say about X'.",
  params: z.object({
    status: z.enum(["new", "dispatched", "resolved", "archived"]).optional(),
    project: z.string().max(80).optional().describe("project name fragment"),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  example: 'TOOL: list_feedback\nARGS: {"status": "new", "limit": 5}',
  handler: async ({ status, project, limit }, ctx) => {
    const facts = await feedbackFacts(ctx.userId, {
      limit: typeof limit === "number" ? limit : LIST_LIMIT,
      ...(status ? { status: status as FeedbackStatus } : {}),
      ...(project ? { projectName: String(project) } : {}),
    });
    if (facts.length === 0) {
      const scope = [status ? `status ${status}` : "", project ? `project "${project}"` : ""]
        .filter(Boolean)
        .join(", ");
      return empty(
        `No feedback reports${scope ? ` with ${scope}` : ""} — the query ran and matched nothing.`,
      );
    }
    return { facts };
  },
});

/** Agent runs — did it start, finish, fail; what is waiting. */
const listRunsTool = defineTool({
  name: "list_runs",
  kind: "read",
  description:
    "Agent runs (dispatches) across the fleet, newest first — state, outcome, error text, and the agent's own handoff. Filter by state (waiting, running, done, error, closed) or project, and by a window in hours. Use for 'did it finish', 'what failed', 'what is stuck waiting'.",
  params: z.object({
    state: z.enum(ORCHESTRATION_STATES).optional(),
    project: z.string().max(80).optional().describe("project key"),
    hours: z.number().int().min(1).max(720).optional().describe("look back this many hours"),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  example: 'TOOL: list_runs\nARGS: {"state": "waiting", "hours": 24}',
  handler: async ({ state, project, hours, limit }, ctx) => {
    const facts = await runFacts(ctx.userId, {
      limit: typeof limit === "number" ? limit : LIST_LIMIT,
      ...(state ? { states: [state as OrchestrationState] } : {}),
      ...(project ? { projectKey: String(project) } : {}),
      ...(typeof hours === "number" ? { sinceMs: hours * HOUR_MS } : {}),
    });
    if (facts.length === 0) {
      const scope = [
        state ? `state ${state}` : "",
        project ? `project ${project}` : "",
        typeof hours === "number" ? `last ${hours}h` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return empty(
        `No runs${scope ? ` matching ${scope}` : ""} — the query ran and matched nothing.`,
      );
    }
    return { facts };
  },
});

const listActiveAgentsTool = defineTool({
  name: "list_active_agents",
  kind: "read",
  description:
    "Agents working RIGHT NOW, by their own report (open Claude Code turns) — which project, since when.",
  params: z.object({}),
  example: "TOOL: list_active_agents\nARGS: {}",
  handler: async (_args, ctx) => {
    const facts = await sessionFacts(ctx.userId);
    return facts.length > 0 ? { facts } : empty("No agent is reporting an open turn right now.");
  },
});

const fleetStatusTool = defineTool({
  name: "fleet_status",
  kind: "read",
  description:
    "The fleet's pulse in one record: runner connected or not, agents working now, runs waiting/errored, open alerts, pending approvals, unread feedback, today's AI budget. Use for 'what needs me', 'status', 'is everything ok'.",
  params: z.object({}),
  example: "TOOL: fleet_status\nARGS: {}",
  handler: async (_args, ctx) => ({ facts: await fleetStatusFacts(ctx.userId) }),
});

const listAlertsTool = defineTool({
  name: "list_alerts",
  kind: "read",
  description:
    "Open alerts Loki raised and the operator has not dismissed — CI failures, overdue commitments, stale relationships, bills due.",
  params: z.object({}),
  example: "TOOL: list_alerts\nARGS: {}",
  handler: async (_args, ctx) => {
    const facts = await alertFacts(ctx.userId, LIST_LIMIT);
    return facts.length > 0 ? { facts } : empty("No open alerts.");
  },
});

const listCapturesTool = defineTool({
  name: "list_notes",
  kind: "read",
  description:
    "The operator's sticky notes — things they told Loki to remember or jot down, newest first.",
  params: z.object({}),
  example: "TOOL: list_notes\nARGS: {}",
  handler: async (_args, ctx) => {
    const facts = await captureFacts(ctx.userId, LIST_LIMIT);
    return facts.length > 0 ? { facts } : empty("No sticky notes saved.");
  },
});

/**
 * The OpenClaw gateway, demoted from "the brain" to one tool among many.
 *
 * Its answer is prose from an agent with its own memory and its own file
 * access — exactly the untrusted surface that produced the original
 * fabrications. So it is wrapped as a `document` fact whose source says so
 * loudly, which means the verifier treats its content as evidence only for
 * what it literally said, and the model must attribute rather than assert.
 */
const askOpenClawTool = defineTool({
  name: "ask_openclaw",
  kind: "read",
  description:
    "Ask the operator's OpenClaw agent (the Telegram/WhatsApp brain, with its own separate memory and workspace files). Use ONLY for things outside Loki's database. Its reply is an unverified second-hand report — attribute it, never state it as fact.",
  params: z.object({ question: z.string().min(2).max(500) }),
  example:
    'TOOL: ask_openclaw\nARGS: {"question": "what did we agree in the Telegram thread about the lease?"}',
  handler: async ({ question }) => {
    if (!isGatewayConfigured())
      return empty("The OpenClaw gateway is not configured — that source is unavailable.");
    const res = await askGatewayAgent(String(question), {}).catch(() => null);
    const text = (res?.text ?? "").trim();
    if (!res?.ok || !text)
      return empty("The OpenClaw agent did not answer — that source is unavailable this turn.");
    return {
      facts: [
        makeFact({
          kind: "document",
          subject: `OpenClaw reply to "${String(question).slice(0, 60)}"`,
          source: "openclaw agent (UNVERIFIED second-hand report, not Loki data)",
          values: {
            title: "OpenClaw agent reply",
            source: "openclaw agent",
            excerpt: text.slice(0, 1200),
          },
        }),
      ],
    };
  },
});

/**
 * The only way Loki affects the world: a DRAFT in the approval queue.
 *
 * Note what is deliberately absent — no send, no write, no execute. Loki
 * proposes; the operator approves. The tool returns the created draft as a
 * fact so the model reports what it actually queued rather than narrating a
 * completed action, which is the exact over-claim ("I booked it") the
 * capability preamble exists to prevent.
 */
const proposeActionTool = defineTool({
  name: "propose_action",
  kind: "propose",
  description:
    "Queue a draft action for the operator to approve (message, email, calendar event, commitment, follow-up, dispatch to a project). Nothing happens until they approve it. Never claim the action was done.",
  params: z.object({
    type: z.enum([
      "send_message",
      "send_email",
      "create_event",
      "create_commitment",
      "follow_up",
      "dispatch_prompt",
      "other",
    ]),
    title: z.string().min(3).max(160).describe("what the operator will see in the queue"),
    reasoning: z
      .string()
      .max(600)
      .optional()
      .describe("why you are proposing this, citing a record id"),
    to: z.string().max(120).optional(),
    body: z.string().max(4000).optional(),
    dueDate: z.string().max(40).optional(),
    // Calendar fields. Their absence was a real bug, not an omission: a
    // create_event proposal could only carry title/to/body/dueDate, so the WHEN
    // of an appointment had nowhere to go and arrived as prose in `body`. The
    // booker then had to recover it with a Groq pass over free text
    // (enrichEventPayloadFromText), which is a language model guessing at a
    // value the model one step earlier already knew exactly. A field the
    // producer cannot fill is a field the consumer has to invent.
    eventStart: z
      .string()
      .max(40)
      .optional()
      .describe("RFC3339 start with offset, e.g. 2026-09-19T14:00:00+02:00"),
    eventEnd: z.string().max(40).optional().describe("RFC3339 end; defaults to start +1h"),
    eventDate: z.string().max(40).optional().describe("YYYY-MM-DD when only the day is known"),
    eventLocation: z.string().max(200).optional(),
    allDay: z.boolean().optional(),
  }),
  example:
    'TOOL: propose_action\nARGS: {"type": "send_message", "title": "Message Elena Weber about funding", "to": "Elena Weber SINGA Switzerland", "body": "Hi Elena — ...", "reasoning": "contact exists in [F2]; no prior interaction recorded"}\nTOOL: propose_action\nARGS: {"type": "create_event", "title": "Dentist", "eventStart": "2026-09-19T14:00:00+02:00", "eventEnd": "2026-09-19T15:00:00+02:00", "eventLocation": "Zahnarztpraxis Oerlikon"}',
  handler: async (args, ctx) => {
    const a = args as {
      type: ActionType;
      title: string;
      reasoning?: string;
      to?: string;
      body?: string;
      dueDate?: string;
      eventStart?: string;
      eventEnd?: string;
      eventDate?: string;
      eventLocation?: string;
      allDay?: boolean;
    };
    const person =
      a.type === ACTION_TYPE.SEND_MESSAGE || a.type === ACTION_TYPE.SEND_EMAIL
        ? await resolvePersonToReach(ctx.userId, a.to, a.title).catch(() => null)
        : null;
    const reach = person ? reachFromPerson(person) : null;
    // A DB failure and the intentional dedupe (an identical draft title is
    // already pending) must not collapse into the same `null`: the first is
    // "nothing was queued", the second is "it is already queued". Reporting a
    // failed write as a successful queue is the over-claim this tool exists
    // to prevent.
    let writeFailed = false;
    const outcome = await enqueueAction(
      ctx.userId,
      {
        type: a.type ?? ACTION_TYPE.OTHER,
        title:
          person && (a.type === ACTION_TYPE.SEND_MESSAGE || a.type === ACTION_TYPE.SEND_EMAIL)
            ? `Message ${person.name}`.slice(0, 160)
            : a.title,
        reasoning: person
          ? `Matched ${person.name}${reach ? ` on ${reach.channel}` : ""}.`
          : (a.reasoning ?? null),
        payload: enrichReachPayload(
          {
            to: a.to,
            body: a.body,
            dueDate: a.dueDate,
            eventTitle: a.type === ACTION_TYPE.CREATE_EVENT ? a.title : undefined,
            eventStart: a.eventStart,
            eventEnd: a.eventEnd,
            eventDate: a.eventDate,
            eventLocation: a.eventLocation,
            allDay: a.allDay,
          },
          reach,
        ),
        entityId: person?.id ?? null,
      },
      // The operator is in this conversation right now — this tool only fires
      // because they asked for something. That is exactly the case a per-item
      // card is for.
      { operatorRequested: true },
    ).catch(() => {
      writeFailed = true;
      return null;
    });

    if (writeFailed || !outcome) {
      return empty(`Could not write that draft to the approval queue. Nothing was queued.`);
    }
    if (outcome.result === "deduped") {
      return empty(
        `A draft titled "${a.title}" is already waiting in the approval queue — not duplicated.`,
      );
    }

    const created = outcome.action;
    // The fact's `status` and `source` are what stop the model claiming a
    // booking it did not make — so they must now distinguish the two real
    // outcomes. Under a standing rule the action IS being carried out, and
    // saying "awaiting approval" would be the mirror-image lie of the one this
    // wording was written to prevent.
    const auto = outcome.result === "auto";
    return {
      facts: [
        makeFact({
          kind: "commitment",
          subject: created.title,
          source: auto
            ? "action queue (APPROVED by the operator's standing rule — being carried out now)"
            : "approval queue (DRAFT — awaiting the operator's approval, not yet done)",
          values: {
            title: created.title,
            due: a.dueDate ?? null,
            when: a.eventStart ?? a.eventDate ?? null,
            counterparty: a.to ?? null,
            status: auto
              ? outcome.execution.executed
                ? "done"
                : "approved — running now"
              : "draft — needs approval",
          },
        }),
      ],
    };
  },
});

const listCrewTool = defineTool({
  name: "list_crew",
  kind: "read",
  description:
    "The humans the operator delegates work to, with their role, skills and how many assignments are open with each. Use before proposing an assignment so you name someone who actually exists.",
  params: z.object({}),
  example: "TOOL: list_crew\nARGS: {}",
  handler: async (_args, ctx) => {
    const facts = await crewFacts(ctx.userId, LIST_LIMIT);
    if (facts.length === 0) {
      return empty("The operator has nobody in the loop yet — no crew to assign work to.");
    }
    return { facts };
  },
});

const listHumanTasksTool = defineTool({
  name: "list_human_tasks",
  kind: "read",
  description:
    "Open assignments handed to people — who has what, whether they accepted, and what is waiting on the operator. Use for 'who owes me what' or 'what did I delegate'. Distinct from agent work.",
  params: z.object({}),
  example: "TOOL: list_human_tasks\nARGS: {}",
  handler: async (_args, ctx) => {
    const facts = await humanTaskFacts(ctx.userId, LIST_LIMIT);
    if (facts.length === 0) return empty("No assignments are open with anyone right now.");
    return { facts };
  },
});

/**
 * Loki's second proposal path — and it is a proposal in exactly the same sense
 * as the action queue.
 *
 * A human assignment is written as a DRAFT: no link is minted, no person is
 * contacted, nothing leaves Loki. Handing it over is a separate click the
 * operator makes on /crew. So this tool cannot reach a human any more than
 * `propose_action` can send a message, which is what makes it safe to give a
 * small model.
 */
const proposeHumanTaskTool = defineTool({
  name: "propose_human_task",
  kind: "propose",
  description:
    "Draft an assignment for a HUMAN (not an agent) — calls to make, a document to sign, a room to walk into. Saved as a draft on the crew board; the operator hands it over themselves. Never claim the person has been asked.",
  params: z.object({
    title: z.string().min(3).max(160).describe("the ask, one line"),
    brief: z.string().max(4000).optional().describe("what to do, written for the person doing it"),
    reason: z.string().max(1000).optional().describe("why it matters"),
    assignee: z
      .string()
      .max(120)
      .optional()
      .describe("name of someone on the crew, if the operator named one"),
    dueDate: z.string().max(40).optional(),
  }),
  example:
    'TOOL: propose_human_task\nARGS: {"title": "Call the three Basel suppliers", "brief": "Ask each for a quote on 200 units, delivery before month end.", "reason": "We need a second quote before the board meeting.", "assignee": "Jana Roth"}',
  handler: async (args, ctx) => {
    const a = args as {
      title: string;
      brief?: string;
      reason?: string;
      assignee?: string;
      dueDate?: string;
    };
    // Resolve a NAME to a person the operator already has. Exact match, then a
    // whole-word match — never a bare substring, which is the dr-UZH-nikov
    // pattern (registry.ts) reintroduced on the write side. An unmatched name
    // leaves the draft unassigned rather than inventing a contact.
    const crew = await listCrew(ctx.userId).catch(() => []);
    const wanted = (a.assignee ?? "").trim().toLowerCase();
    const wordMatch = (name: string) =>
      name
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w === wanted || wanted.split(/\s+/).includes(w));
    const match = wanted
      ? (crew.find((m) => m.name.toLowerCase() === wanted) ?? crew.find((m) => wordMatch(m.name)))
      : undefined;

    const created = await createHumanTask(
      ctx.userId,
      {
        title: a.title,
        brief: a.brief,
        reason: a.reason,
        assigneeId: match?.id,
        dueDate: a.dueDate,
      },
      TASK_ACTOR.LOKI,
    ).catch(() => null);

    if (!created) {
      return empty(`Could not write that assignment down. Nothing was sent to anyone.`);
    }
    return {
      facts: [
        makeFact({
          kind: "assignment",
          subject: created.title,
          source: "crew board (DRAFT — nobody has been asked yet)",
          values: {
            title: created.title,
            assignee: created.assigneeName,
            due: a.dueDate ?? null,
            why: a.reason ?? null,
            status:
              wanted && !match
                ? `draft — nobody matched "${a.assignee}", assign it on the crew board`
                : "draft — the operator hands it over",
          },
        }),
      ],
    };
  },
});

export const LOKI_TOOLS: ToolRegistry = Object.fromEntries(
  [
    searchPeopleTool,
    searchProjectsTool,
    searchKnowledgeTool,
    listFeedbackTool,
    listRunsTool,
    listActiveAgentsTool,
    fleetStatusTool,
    listAlertsTool,
    listGoalsTool,
    listHabitsTool,
    listCommitmentsTool,
    listPendingApprovalsTool,
    listCapturesTool,
    askOpenClawTool,
    listCrewTool,
    listHumanTasksTool,
    proposeActionTool,
    proposeHumanTaskTool,
  ].map((t) => [t.name, t]),
);
