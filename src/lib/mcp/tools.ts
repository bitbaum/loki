/**
 * The tools a connected AI app can call on Loki.
 *
 * Each one is a thin adapter: validate the arguments, check the scope, call the
 * SAME function the matching HTTP route calls (through McpServices), and turn
 * the result into a sentence a model can relay without embellishing. Nothing
 * here decides anything the Telegram skill does not already decide the same
 * way — act tools go through the approval queue exactly as it does.
 *
 * Descriptions are written for a model choosing between tools, not for a
 * person: when to reach for it, and the one thing it must not claim afterwards.
 */
import { z } from "zod";
import {
  MCP_LINK_ACCOUNT_URL,
  MCP_MESSAGE_MAX_CHARS,
  MCP_SCOPE,
  MCP_TOOL_SCOPES,
  type McpScope,
  type McpToolName,
} from "@/config/mcp";
import type { McpCaller, McpServices } from "@/lib/mcp/types";

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolContext = { userId: string; caller: McpCaller; services: McpServices };

type McpToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  title: string;
  description: string;
  input: S;
  /** MCP tool annotations — hints a client uses to decide when to ask the user first. */
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<McpToolResult>;
};

const text = (t: string, structured?: Record<string, unknown>): McpToolResult => ({
  content: [{ type: "text", text: t }],
  ...(structured ? { structuredContent: structured } : {}),
});

export const toolError = (t: string): McpToolResult => ({
  content: [{ type: "text", text: t }],
  isError: true,
});

function define<S extends z.ZodTypeAny>(def: McpToolDef<S>): McpToolDef {
  return def as unknown as McpToolDef;
}

const clip = (s: string | null | undefined, n: number) =>
  !s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** An ISO 8601 instant that names its offset — Loki will not guess a timezone. */
const ABSOLUTE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A conversation id becomes part of a session key, so it is held to a safe alphabet. */
const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Resolve an action id the way the Telegram skill does: a full id passes
 * through, a prefix must match exactly one open draft. Ambiguity and a miss are
 * both answered, never guessed — approving the wrong row executes it.
 */
export function resolveActionId(
  idOrPrefix: string,
  pendingIds: string[],
): { ok: true; id: string } | { ok: false; error: string } {
  const needle = idOrPrefix.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(needle)) {
    return { ok: true, id: needle };
  }
  const matches = pendingIds.filter((id) => id.toLowerCase().startsWith(needle));
  if (matches.length === 1) return { ok: true, id: matches[0] };
  if (matches.length === 0) {
    return { ok: false, error: `No pending action matches "${idOrPrefix}".` };
  }
  return {
    ok: false,
    error: `"${idOrPrefix}" matches ${matches.length} pending actions — use more characters.`,
  };
}

export const MCP_TOOLS: Record<McpToolName, McpToolDef> = {
  ask_loki: define({
    title: "Ask Loki",
    description:
      "Ask Loki, the owner's execution assistant, a question in plain language. It answers from their own records: registered projects and what the agent fleet did on them, feedback, people, commitments, calendar and the approval queue. Use it for anything about their work or schedule you cannot see yourself. Pass the same conversation_id on follow-ups to keep one thread.",
    input: z.object({
      message: z.string().trim().min(1).max(MCP_MESSAGE_MAX_CHARS),
      conversation_id: z
        .string()
        .regex(CONVERSATION_ID, "conversation_id: letters, digits, - and _ only (max 64)")
        .optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async run(args, { userId, caller, services }) {
      const sessionKey = `agent:main:mcp:${userId}${args.conversation_id ? `:${args.conversation_id}` : ""}`;
      const { status, body } = await services.ask(userId, args.message, {
        sessionKey,
        // A chat-only grant may not reach Loki's own propose tools by asking.
        readOnly: !caller.scopes.has(MCP_SCOPE.act),
      });
      if (status !== 200 || typeof body.text !== "string") {
        // Budget refusals (429) and outages carry a sentence meant for a person.
        return toolError(typeof body.error === "string" ? body.error : "Loki did not answer.");
      }
      const answer = body.text;
      const sources = Array.isArray(body.sources)
        ? (body.sources as Array<{ id: string; label: string; detail: string }>).filter((s) =>
            answer.includes(`[${s.id}]`),
          )
        : [];
      const footer = sources.length
        ? `\n\nSources:\n${sources
            .slice(0, 10)
            .map((s) => `[${s.id}] ${clip(s.label, 80)} — ${clip(s.detail, 160)}`)
            .join("\n")}`
        : "";
      return text(`${answer}${footer}`);
    },
  }),

  loki_pending_approvals: define({
    title: "Pending approvals",
    description:
      "List the actions waiting for the owner's approval in Loki's queue (messages, emails, calendar events, dispatches Loki proposed). Returns each one's id, type, title and why it was proposed. Use when asked what is waiting, before loki_decide.",
    input: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async run(_args, { userId, services }) {
      const pending = await services.pendingApprovals(userId);
      if (pending.length === 0) return text("Nothing is waiting for approval.", { pending: [] });
      const lines = pending.map(
        (a) =>
          `- ${a.id.slice(0, 8)} · ${a.type} · ${clip(a.title, 120)}${a.reasoning ? ` — ${clip(a.reasoning, 160)}` : ""}`,
      );
      return text(`${pending.length} waiting for approval:\n${lines.join("\n")}`, {
        pending: pending.map((a) => ({
          id: a.id,
          type: a.type,
          title: a.title,
          description: a.description,
          reasoning: a.reasoning,
          createdAt: a.createdAt,
          expiresAt: a.expiresAt,
        })),
      });
    },
  }),

  loki_decide: define({
    title: "Approve or reject",
    description:
      "Approve or reject one action in Loki's approval queue. Approving EXECUTES it (sends the message, books the event, runs the dispatch). Call only when the owner has explicitly said approve or reject for this specific item in this conversation; never on your own judgement, and never for several items from one vague 'approve all' without listing them first. action_id may be the full id or the 8-character prefix from loki_pending_approvals.",
    input: z.object({
      action_id: z.string().trim().min(4).max(64),
      decision: z.enum(["approve", "reject"]),
      reason: z.string().trim().max(500).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async run(args, { userId, caller, services }) {
      const pending = await services.pendingApprovals(userId);
      const resolved = resolveActionId(
        args.action_id,
        pending.map((a) => a.id),
      );
      if (!resolved.ok) return toolError(resolved.error);
      const outcome = await services.decide(userId, resolved.id, args.decision, {
        reason: args.reason,
        meta: { via: "mcp", clientId: caller.clientId ?? null },
      });
      if (!outcome.found) {
        return toolError("No open draft with that id — it may already have been decided.");
      }
      const title = pending.find((a) => a.id === outcome.id)?.title;
      const what = title ? `"${clip(title, 120)}"` : outcome.id.slice(0, 8);
      if (args.decision === "reject") {
        return text(`Rejected ${what}. Nothing was executed.`, {
          id: outcome.id,
          status: outcome.status,
        });
      }
      const r = outcome.result;
      const effect = !r
        ? "Approved."
        : r.executed
          ? "Approved and executed."
          : r.deferred
            ? "Approved; it runs shortly and the owner is notified when it has."
            : `Approved, but it did not execute${r.error ? ` (${r.error})` : ""}.`;
      return text(`${effect} ${what}`, {
        id: outcome.id,
        status: outcome.status,
        executed: r?.executed ?? false,
        deferred: r?.deferred ?? false,
      });
    },
  }),

  loki_dispatch: define({
    title: "Dispatch a task",
    description:
      "Send a coding task to one of the owner's projects; that project's AI agent does the work. Use loki_projects first for the exact name. The work runs asynchronously and the outcome is pushed to the owner as a notification when it finishes — say it is dispatched, do not poll or claim it is done. Repeat destructive tasks (deletes, force-pushes, production data changes) back to the owner and get a yes before calling.",
    input: z.object({
      project: z.string().trim().min(1).max(80),
      task: z.string().trim().min(1).max(MCP_MESSAGE_MAX_CHARS),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async run(args, { userId, services }) {
      const { status, body } = await services.dispatch(userId, args.project, args.task);
      if (status === 404) {
        return toolError(
          `${String(body.error ?? "Project not found")}. Call loki_projects for the names Loki knows.`,
        );
      }
      if (status >= 400 || body.ok === false) {
        const next = typeof body.nextAction === "string" ? ` ${body.nextAction}` : "";
        return toolError(`${String(body.error ?? `Dispatch failed (${status})`)}.${next}`);
      }
      const where =
        body.hostedDispatchId !== undefined
          ? "the hosted cloud runner"
          : body.channel === "local"
            ? "the owner's Fleet Runner"
            : "the cloud builder";
      const how =
        body.mode === "queued"
          ? `Queued for ${where}.`
          : `Delivered to the ${String(body.tab ?? args.project)} agent.`;
      const warning = typeof body.message === "string" ? ` ${body.message}` : "";
      return text(
        `${how}${warning} The outcome will reach the owner as a notification when the run finishes.`,
        {
          mode: body.mode ?? null,
          channel: body.channel ?? null,
          runId: body.runId ?? null,
          warning: body.warning ?? null,
        },
      );
    },
  }),

  loki_book: define({
    title: "Book an appointment",
    description:
      "Put an appointment in the owner's calendar through Loki's approval queue. start and end are absolute ISO 8601 times WITH an offset (2026-09-19T14:00:00+02:00) — resolve 'Friday at 2' yourself first; a bare YYYY-MM-DD books an all-day event. Report the returned status literally: 'auto-approved' means it is being booked under the owner's standing approval; 'awaiting-approval' means it waits for their yes (they already have one-tap buttons) and is NOT booked yet.",
    input: z
      .object({
        title: z.string().trim().min(1).max(200),
        start: z
          .string()
          .trim()
          .refine(
            (s) => ABSOLUTE_TIME.test(s) || DATE_ONLY.test(s),
            "start must be YYYY-MM-DD or an ISO time with an offset",
          ),
        end: z
          .string()
          .trim()
          .regex(ABSOLUTE_TIME, "end must be an ISO time with an offset")
          .optional(),
        location: z.string().trim().max(300).optional(),
      })
      .refine((b) => !(b.end && DATE_ONLY.test(b.start)), {
        message: "an all-day event (date-only start) takes no end time",
      })
      .refine((b) => !b.end || new Date(b.end).getTime() > new Date(b.start).getTime(), {
        message: "end must be after start",
      }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async run(args, { userId, services }) {
      const report = await services.book(userId, args);
      if (report.deduped) {
        return text(
          `An identical "${clip(args.title, 120)}" is already waiting for approval — nothing new was queued.`,
          { deduped: true },
        );
      }
      const id = report.action.id;
      if (report.status === "auto-approved") {
        const said = report.executed
          ? "It is in the calendar."
          : "It is being booked now; the owner gets a confirmation once it is in the calendar.";
        return text(`Covered by the owner's standing approval. ${said}`, {
          status: report.status,
          id,
          executed: report.executed,
          deferred: report.deferred,
        });
      }
      return text(
        `Waiting for the owner's approval${report.reason ? ` (${report.reason})` : ""} — not booked yet. They have one-tap buttons to approve it.`,
        { status: report.status, id, reason: report.reason ?? null },
      );
    },
  }),

  loki_projects: define({
    title: "Projects",
    description:
      "List the owner's registered projects with a one-line status each: what it is, where it is live, which builder runs it, and when work was last dispatched. Use to pick the exact project name for loki_dispatch, or to answer 'what am I working on'.",
    input: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async run(_args, { userId, services }) {
      const projects = await services.projects(userId);
      if (projects.length === 0) {
        return text("No projects are registered in Loki yet.", { projects: [] });
      }
      const lines = projects.map((p) => {
        const parts = [
          clip(p.description, 100),
          p.liveUrl ? `live at ${p.liveUrl}` : "",
          p.builderPref === "local" ? "runs on Fleet Runner" : "runs in the cloud",
          p.lastDispatchAt ? `last dispatch ${p.lastDispatchAt.slice(0, 10)}` : "never dispatched",
        ].filter(Boolean);
        return `- ${p.name}: ${parts.join(" · ")}`;
      });
      return text(`${projects.length} projects:\n${lines.join("\n")}`, { projects });
    },
  }),
};

/** tools/list — every tool, so a model can tell the owner which grant is missing. */
export function listTools() {
  return (Object.entries(MCP_TOOLS) as Array<[McpToolName, McpToolDef]>).map(([name, t]) => {
    const { $schema: _drop, ...inputSchema } = z.toJSONSchema(t.input, { io: "input" }) as {
      $schema?: string;
    } & Record<string, unknown>;
    void _drop;
    const scope = MCP_TOOL_SCOPES[name];
    return {
      name,
      title: t.title,
      description: `${t.description} Requires the ${scope} scope.`,
      inputSchema,
      annotations: { title: t.title, ...t.annotations },
    };
  });
}

/**
 * tools/call. Returns null for an unknown tool (a protocol error, -32602);
 * everything else — a missing scope, bad arguments, an unlinked account, a
 * failure inside Loki — is a tool result with isError, which the model sees
 * and can act on.
 */
export async function callTool(
  name: string,
  rawArgs: unknown,
  caller: McpCaller,
  services: McpServices,
): Promise<McpToolResult | null> {
  if (!Object.hasOwn(MCP_TOOLS, name)) return null;
  const tool = MCP_TOOLS[name as McpToolName];
  const scope: McpScope = MCP_TOOL_SCOPES[name as McpToolName];

  if (!caller.scopes.has(scope)) {
    return toolError(
      `${name} needs the ${scope} scope, which this connection was not granted. Reconnect Loki and allow ${scope}.`,
    );
  }
  if (!caller.userId) {
    return toolError(
      `This OrangeCat account is not linked to a Loki account yet. Sign in to Loki once with OrangeCat at ${MCP_LINK_ACCOUNT_URL}, then retry.`,
    );
  }

  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return toolError(
      `Invalid arguments for ${name} — ${where}${issue?.message ?? "invalid input"}`,
    );
  }

  try {
    return await tool.run(parsed.data, { userId: caller.userId, caller, services });
  } catch (e) {
    console.error(`[mcp] ${name} failed:`, e instanceof Error ? e.message : e);
    return toolError(`Loki could not complete ${name} right now. Try again shortly.`);
  }
}
