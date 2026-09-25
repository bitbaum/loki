/**
 * The Loki core: turn a human message into one of three outcomes and persist
 * the whole exchange. Steps (docs/loki-command-surface.md §3–§4):
 *   1. persist the user turn
 *   2. resolveCommand() — the SHARED resolver (src/lib/command-resolve.ts)
 *   3a. command + projectKey  → dispatch into the project session via injectPrompt(),
 *                               persist an assistant "dispatch" turn
 *   3b. chat                  → ask Loki via askLoki(), persist an assistant "chat" turn
 *   3c. command, no project   → persist an assistant "command" turn asking which
 *                               project (meta.needsProject)
 *
 * Dispatch + chat call the shared cores (inject-core / loki-core) in-process —
 * the same SSOT the /api/inject and /api/loki routes wrap. No self-HTTP.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { readIdParam, readJsonBody, z, isUniqueViolation } from "@/lib/api/route-helpers";
import {
  countActiveProjects,
  createUserProject,
  getUserProjects,
} from "@/db/queries/user-projects";
import { getUserById } from "@/db/queries/users";
import {
  getConversationWithMessages,
  addMessage,
  updateConversationProjects,
  updateConversationTitle,
  deriveConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
} from "@/db/queries/conversations";
import type { Conversation, ConversationMessage } from "@/db/schema/conversations";
import {
  resolveCommand,
  isGenericDevelopHandoff,
  type CommandResolution,
} from "@/lib/command-resolve";
import { injectPrompt } from "@/lib/inject-core";
import { askLoki } from "@/lib/loki-core";
import { pickProvenance } from "@/lib/loki/provenance";
import { enqueueProposalFromMessage } from "@/lib/actions/enqueue-proposal";
import { ORCHESTRATION_ADAPTER_IDS, type AdapterId } from "@/lib/orchestration";
import {
  MAX_ATTACHMENTS,
  AttachmentBodySchema,
  attachmentNoteLabel,
  normalizeAttachment,
  renderTextAttachments,
  type Attachment,
} from "@/lib/loki/attachments";
import { describeAttachedImages } from "@/lib/loki/vision";
import { dispatchAssistantContent } from "@/lib/dispatch-status";
import { isBuilderChannel } from "@/lib/constants/statuses";
import { buildLokiChatPrompt, resolveLokiChatProjectKey } from "@/lib/loki/chat-context";
import { projectMentionedIn, unknownProjectMention } from "@/lib/project-mention";
import {
  formatProjectList,
  isBusinessPlanRequest,
  isDevelopAllFleetRequest,
  isMoveForwardRequest,
  isListProjectsQuery,
  parseCreateProjectRequest,
  parseProfileUpdateRequest,
  projectNameFromConversationTitle,
  resolveFleetCommandProjectKey,
} from "@/lib/loki-fleet-commands";
import {
  formatBusinessPlanReply,
  formatProfileUpdateReply,
  proposeLokiProfileUpdate,
  runLokiBusinessPlan,
} from "@/lib/loki/project-mutations";
import { formatFleetKickReply, kickFleet } from "@/lib/fleet-kick";
import { resolveDispatchTargets, shouldAskForProject } from "@/lib/loki/dispatch-targets";
import { dispatchCommandToProjects, formatMultiDispatchReply } from "@/lib/loki/multi-dispatch";
import {
  DEFAULT_VISION_QUESTION,
  shouldDispatchScreenshot,
  screenshotDispatchIntentId,
  screenshotDispatchPrompt,
} from "@/lib/loki/screenshot-dispatch";
import { getProjectLimit } from "@/lib/plan";
import {
  parseStickyNoteRequest,
  formatStickyAddReply,
  formatStickyListReply,
} from "@/lib/loki/sticky-note";
import { createCapture, listCaptures, countCaptures } from "@/db/queries/captures";
import { sseResponse } from "@/lib/api/sse";
import { encodeLokiEvent, type LokiStreamEvent, type WireMessage } from "@/lib/loki/stream";

const Body = z
  .object({
    text: z.string().trim().max(4000),
    selectedProjects: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    agent: z.enum(ORCHESTRATION_ADAPTER_IDS).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    attachments: z.array(AttachmentBodySchema).max(MAX_ATTACHMENTS).optional(),
    dispatchOnly: z.boolean().optional(),
    // Force the chat path, skipping the command classifier. The proactive
    // fleet-review starters are definitionally analysis/Q&A, not "run work on a
    // project" — without this the classifier can misread "review my fleet" as a
    // command and return a needs-project picker instead of Loki's answer.
    chatOnly: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const hasAttach = (data.attachments?.length ?? 0) > 0;
    if (!data.text.trim() && !hasAttach) {
      ctx.addIssue({
        code: "custom",
        message: "Message text or an attachment is required.",
        path: ["text"],
      });
    }
  });

type DispatchOpts = {
  userId: string;
  conversationId: string;
  existing: { conversation: Conversation; messages: ConversationMessage[] };
  projectKey: string;
  prompt: string;
  sourceText: string;
  intentId: string | null;
  attachmentSuffix: string;
  agent?: AdapterId;
  model?: string;
  attachments?: Attachment[];
};

async function buildAttachmentSuffix(
  attachments: Attachment[] | undefined,
  userText: string,
): Promise<string> {
  const normalized = attachments ?? [];
  const images = normalized.filter(
    (a): a is Extract<Attachment, { kind: "image" }> => a.kind === "image",
  );
  const vision = await describeAttachedImages(images, userText);
  return renderTextAttachments(normalized) + vision;
}

async function persistDispatch(opts: DispatchOpts): Promise<ConversationMessage> {
  const useIntentKey =
    Boolean(opts.intentId) &&
    isGenericDevelopHandoff(opts.sourceText) &&
    !(opts.attachments && opts.attachments.length > 0);
  const inject = await injectPrompt(
    useIntentKey
      ? {
          tab: opts.projectKey,
          promptKey: opts.intentId!,
          adapter: opts.agent,
          model: opts.model,
          // A person typed this: tell them how it ended, in this thread.
          notifyOnClose: true,
          conversationId: opts.conversationId,
        }
      : {
          tab: opts.projectKey,
          customPrompt: opts.prompt + opts.attachmentSuffix,
          adapter: opts.agent,
          model: opts.model,
          notifyOnClose: true,
          conversationId: opts.conversationId,
        },
    opts.userId,
  );
  const ok = inject.status < 400;
  const dispatchInput = {
    ok,
    mode: typeof inject.body.mode === "string" ? inject.body.mode : null,
    warning: typeof inject.body.warning === "string" ? inject.body.warning : null,
    runnerConnected:
      typeof inject.body.runnerConnected === "boolean" ? inject.body.runnerConnected : null,
    // Validate against the union rather than trusting the string: meta is
    // persisted and replayed months later, and an unknown channel would index
    // the name map to undefined and quietly drop the builder from the label.
    channel: isBuilderChannel(inject.body.channel) ? inject.body.channel : null,
  };
  // Identifiers the transcript footer polls to show LIVE dispatch status
  // (queued → picked up → ran/failed) instead of a frozen "starting shortly".
  // commandId is present only for queued (cloud-drained) dispatches; runId
  // tracks the underlying orchestration run.
  const commandId = typeof inject.body.commandId === "string" ? inject.body.commandId : null;
  const runId = typeof inject.body.runId === "string" ? inject.body.runId : null;
  const content = ok
    ? dispatchAssistantContent(opts.projectKey, dispatchInput)
    : `Could not dispatch to ${opts.projectKey}: ${
        typeof inject.body.error === "string" ? inject.body.error : "dispatch failed"
      }`;
  const assistant = await addMessage(opts.conversationId, {
    role: "assistant",
    kind: "dispatch",
    content,
    meta: {
      projectKey: opts.projectKey,
      intentId: opts.intentId,
      ok,
      mode: dispatchInput.mode,
      warning: dispatchInput.warning,
      runnerConnected: dispatchInput.runnerConnected,
      channel: dispatchInput.channel,
      agent: opts.agent ?? null,
      model: opts.model ?? null,
      commandId,
      runId,
    },
  });
  if (!opts.existing.conversation.projectKeys.includes(opts.projectKey)) {
    await updateConversationProjects(opts.userId, opts.conversationId, [
      ...opts.existing.conversation.projectKeys,
      opts.projectKey,
    ]);
  }
  return assistant;
}

/** Everything one turn of the conversation is answered from. */
type TurnContext = {
  userId: string;
  conversationId: string;
  existing: { conversation: Conversation; messages: ConversationMessage[] };
  text: string;
  currentTitle: string;
  projects: Awaited<ReturnType<typeof getUserProjects>>;
  projectNames: string[];
  selectedProjects: string[];
  agent?: AdapterId;
  model?: string;
  attachments?: Attachment[];
  attachmentSuffix: string;
  hasImages: boolean;
  chatOnly: boolean;
};

type Emit = (event: LokiStreamEvent) => void;

/** A fast path answers the turn, or returns null to let the next one look. */
type TurnHandler = (ctx: TurnContext) => Promise<ConversationMessage | null>;

/** Add this project to the thread's project list if it isn't there yet. */
async function linkProject(ctx: TurnContext, projectKey: string) {
  if (ctx.existing.conversation.projectKeys.includes(projectKey)) return;
  await updateConversationProjects(ctx.userId, ctx.conversationId, [
    ...ctx.existing.conversation.projectKeys,
    projectKey,
  ]);
}

async function linkProjects(ctx: TurnContext, projectKeys: string[]) {
  if (projectKeys.length === 0) return;
  const merged = [...new Set([...ctx.existing.conversation.projectKeys, ...projectKeys])];
  await updateConversationProjects(ctx.userId, ctx.conversationId, merged);
}

const listProjectsTurn: TurnHandler = async (ctx) => {
  if (ctx.chatOnly || !isListProjectsQuery(ctx.text)) return null;
  return addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "chat",
    content: formatProjectList(ctx.projects),
    meta: { source: "fleet-list" },
  });
};

/** Sticky-note fast path — "add X to my list" / "note that X" / "what's on my
 *  list" is a task for the OPERATOR, not an agent. It must land on the sticky
 *  note (captures, rendered on /today), never be misread as a dispatch. */
const stickyNoteTurn: TurnHandler = async (ctx) => {
  const sticky = ctx.chatOnly ? null : parseStickyNoteRequest(ctx.text);
  if (!sticky) return null;
  let content: string;
  if (sticky.kind === "add") {
    await createCapture(ctx.userId, sticky.body);
    content = formatStickyAddReply(sticky.body, await countCaptures(ctx.userId));
  } else {
    const [items, total] = await Promise.all([
      listCaptures(ctx.userId, 10),
      countCaptures(ctx.userId),
    ]);
    content = formatStickyListReply(items, total);
  }
  return addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "chat",
    content,
    meta: { source: "sticky-note" },
  });
};

const createProjectTurn: TurnHandler = async (ctx) => {
  const createReq = ctx.chatOnly ? null : parseCreateProjectRequest(ctx.text);
  if (!createReq) return null;

  let name = createReq.name;
  if (!name) {
    const titled =
      ctx.currentTitle !== "" && ctx.currentTitle !== DEFAULT_CONVERSATION_TITLE
        ? ctx.currentTitle
        : (deriveConversationTitle(ctx.text) ?? "");
    name = projectNameFromConversationTitle(titled);
  }
  if (!name) {
    return addMessage(ctx.conversationId, {
      role: "assistant",
      kind: "chat",
      content:
        "What should the new project be called? Say **create project my-app** or name this conversation first.",
      meta: { source: "create-project-needs-name" },
    });
  }

  const limitReply = await projectLimitReply(ctx);
  if (limitReply) return limitReply;

  let projectName = name;
  try {
    const created = await createUserProject({ userId: ctx.userId, name });
    projectName = created.name;
  } catch (e: unknown) {
    if (!isUniqueViolation(e)) throw e;
  }

  if (createReq.dispatchAfter) {
    return persistDispatch({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      existing: ctx.existing,
      projectKey: projectName,
      prompt: "Continue from our discussion and implement the plan we agreed.",
      sourceText: ctx.text,
      intentId: "next_best",
      attachmentSuffix: ctx.attachmentSuffix,
      agent: ctx.agent,
      model: ctx.model,
      attachments: ctx.attachments,
    });
  }

  return addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "chat",
    content: `Registered **${projectName}**. It is now available from the Project control; say what you want to run.`,
    meta: { source: "create-project", projectKey: projectName },
  });
};

/** The plan's project cap, refused in the thread rather than as a 4xx nobody
 *  sees. The default (seed) user is exempt. */
async function projectLimitReply(ctx: TurnContext): Promise<ConversationMessage | null> {
  const user = await getUserById(ctx.userId);
  if (!user || user.isDefault) return null;
  const limit = getProjectLimit(user.plan);
  if (!Number.isFinite(limit)) return null;
  const current = await countActiveProjects(ctx.userId);
  if (current < limit) return null;
  return addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "chat",
    content: `Project limit reached (${limit} on ${user.plan} plan). Upgrade to add more.`,
    meta: { source: "create-project-limit" },
  });
}

async function kickFleetReply(ctx: TurnContext, source: string): Promise<ConversationMessage> {
  const scopeKeys = ctx.selectedProjects.length > 0 ? ctx.selectedProjects : undefined;
  const outcome = await kickFleet(ctx.userId, {
    source: "loki",
    projectKeys: scopeKeys,
    requireFleetOn: false,
  });
  return addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "chat",
    content: formatFleetKickReply(outcome),
    meta: {
      source,
      kicked: outcome.kicked,
      runnerConnected: outcome.runnerConnected,
    },
  });
}

const developAllFleetTurn: TurnHandler = async (ctx) => {
  if (ctx.chatOnly || !isDevelopAllFleetRequest(ctx.text)) return null;
  return kickFleetReply(ctx, "fleet-kick");
};

const moveForwardTurn: TurnHandler = async (ctx) => {
  if (ctx.chatOnly || !isMoveForwardRequest(ctx.text)) return null;
  if (ctx.selectedProjects.length === 1) {
    return persistDispatch({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      existing: ctx.existing,
      projectKey: ctx.selectedProjects[0],
      prompt: ctx.text,
      sourceText: ctx.text,
      intentId: "next_best",
      attachmentSuffix: ctx.attachmentSuffix,
      agent: ctx.agent,
      model: ctx.model,
      attachments: ctx.attachments,
    });
  }
  return kickFleetReply(ctx, "fleet-kick-move-forward");
};

const businessPlanTurn: TurnHandler = async (ctx) => {
  if (!isBusinessPlanRequest(ctx.text)) return null;
  const fleetProjectKey = resolveFleetCommandProjectKey(
    ctx.text,
    ctx.selectedProjects[0],
    ctx.projectNames,
  );
  const outcome = await runLokiBusinessPlan(ctx.userId, fleetProjectKey, ctx.projects);
  const assistant = await addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "chat",
    content: outcome.ok ? formatBusinessPlanReply(outcome) : outcome.message,
    meta: {
      source: outcome.ok ? "business-plan" : `business-plan-${outcome.code}`,
      projectKey: outcome.ok ? outcome.projectKey : fleetProjectKey,
      entityId: outcome.ok ? outcome.entityId : null,
    },
  });
  if (outcome.ok) await linkProject(ctx, outcome.projectKey);
  return assistant;
};

const profileUpdateTurn: TurnHandler = async (ctx) => {
  const profileUpdate = parseProfileUpdateRequest(ctx.text);
  if (!profileUpdate) return null;
  const fleetProjectKey = resolveFleetCommandProjectKey(
    ctx.text,
    ctx.selectedProjects[0],
    ctx.projectNames,
  );
  const outcome = await proposeLokiProfileUpdate(
    ctx.userId,
    fleetProjectKey,
    ctx.projects,
    profileUpdate,
  );
  const assistant = await addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "chat",
    content: outcome.ok ? formatProfileUpdateReply(outcome) : outcome.message,
    meta: {
      source: outcome.ok ? "profile-update-draft" : `profile-update-${outcome.code}`,
      projectKey: outcome.ok ? outcome.projectKey : fleetProjectKey,
      fieldKey: profileUpdate.fieldKey,
    },
  });
  if (outcome.ok) await linkProject(ctx, outcome.projectKey);
  return assistant;
};

const screenshotTurn: TurnHandler = async (ctx) => {
  const screenshotProject = resolveFleetCommandProjectKey(
    ctx.text,
    ctx.selectedProjects[0],
    ctx.projectNames,
  );
  if (!shouldDispatchScreenshot(ctx.text, ctx.hasImages, screenshotProject)) return null;
  return persistDispatch({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    existing: ctx.existing,
    projectKey: screenshotProject!,
    prompt: screenshotDispatchPrompt(ctx.text),
    sourceText: ctx.text,
    intentId: screenshotDispatchIntentId(ctx.text),
    attachmentSuffix: ctx.attachmentSuffix,
    agent: ctx.agent,
    model: ctx.model,
    attachments: ctx.attachments,
  });
};

/**
 * Deterministic fast paths, in order. Each is a complete answer or a pass.
 *
 * They run before the classifier because they are things the operator asked
 * for literally — a sticky note is not a dispatch, and "list my projects" is
 * not a question for a model. `chatOnly` (the proactive fleet-review starters)
 * skips the ones that would intercept an analysis request; the three below
 * that read the message rather than a phrasebook still apply.
 */
const FAST_PATHS: TurnHandler[] = [
  listProjectsTurn,
  stickyNoteTurn,
  createProjectTurn,
  developAllFleetTurn,
  moveForwardTurn,
  businessPlanTurn,
  profileUpdateTurn,
  screenshotTurn,
];

async function dispatchResolvedCommand(
  ctx: TurnContext,
  resolution: CommandResolution,
  dispatchTargets: string[],
): Promise<ConversationMessage> {
  if (dispatchTargets.length === 1) {
    return persistDispatch({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      existing: ctx.existing,
      projectKey: dispatchTargets[0],
      prompt: resolution.prompt,
      sourceText: ctx.text,
      intentId: resolution.intentId,
      attachmentSuffix: ctx.attachmentSuffix,
      agent: ctx.agent,
      model: ctx.model,
      attachments: ctx.attachments,
    });
  }

  // "Next best" across several projects is the fleet kick, not N dispatches of
  // the same sentence — unless images are attached, which are per-project work.
  if (resolution.intentId === "next_best" && !ctx.hasImages) {
    const kick = await kickFleet(ctx.userId, {
      source: "loki",
      projectKeys: dispatchTargets,
      requireFleetOn: false,
    });
    const assistant = await addMessage(ctx.conversationId, {
      role: "assistant",
      kind: "chat",
      content: formatFleetKickReply(kick),
      meta: { source: "fleet-kick-multi", kicked: kick.kicked },
    });
    await linkProjects(
      ctx,
      kick.details.filter((d) => d.outcome === "kicked").map((d) => d.projectKey),
    );
    return assistant;
  }

  const attempts = await dispatchCommandToProjects({
    userId: ctx.userId,
    projectKeys: dispatchTargets,
    prompt: resolution.prompt,
    sourceText: ctx.text,
    intentId: resolution.intentId,
    attachmentSuffix: ctx.attachmentSuffix,
    agent: ctx.agent,
    model: ctx.model,
    attachments: ctx.attachments,
  });
  const assistant = await addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "dispatch",
    content: formatMultiDispatchReply(attempts, resolution.intentId ?? undefined),
    meta: {
      multiDispatch: true,
      projectKeys: dispatchTargets,
      attempts,
    },
  });
  await linkProjects(
    ctx,
    attempts.filter((a) => a.ok).map((a) => a.projectKey),
  );
  return assistant;
}

/**
 * Say what we understood before asking for more. An operator who typed a name
 * and got back an unexplained list of nine other projects has been told,
 * wrongly, that their message was never read — so when the sentence contains
 * something that reads like a project we don't have, name it.
 */
async function needsProjectReply(
  ctx: TurnContext,
  resolution: CommandResolution,
): Promise<ConversationMessage> {
  const unknown = unknownProjectMention(ctx.text, ctx.projectNames);
  const content = unknown
    ? `I don't have a project called **${unknown}**. Pick the right one below, or I can just answer without running anything.`
    : "Which project should I run that on? Pick one below — or I can just answer instead.";
  return addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "command",
    content,
    meta: {
      needsProject: true,
      intentId: resolution.intentId,
      pendingText: ctx.text,
      projectOptions: ctx.projectNames,
      ...(unknown ? { unknownProject: unknown } : {}),
    },
  });
}

async function chatReply(
  ctx: TurnContext,
  resolution: CommandResolution,
  emit: Emit,
): Promise<ConversationMessage> {
  const chatProject = resolveLokiChatProjectKey(
    resolution,
    ctx.selectedProjects,
    ctx.projectNames,
    ctx.text,
  );
  const chatPrompt = await buildLokiChatPrompt(
    ctx.userId,
    resolution.prompt + ctx.attachmentSuffix,
    chatProject,
  );
  // Answer AND, in parallel, mine the raw user message for an actionable
  // request (message/email/event/commitment) → enqueue a draft the operator
  // approves. This is the queue's producer on the main chat surface; the
  // deterministic parsers above already handle create-project / profile-update,
  // so this only fires for the four external action types. Best-effort — a
  // failure just means nothing queued, never a broken reply.
  const [loki, queued] = await Promise.all([
    askLoki(chatPrompt, {
      // The operator is watching this one: stream the prose and name each
      // tool as it runs, rather than going silent for the whole turn.
      onEvent: emit,
      // Proactive fleet reviews are one-shot analyses — route them to the warm
      // shared ask-session (same as /api/loki) rather than a cold per-conversation
      // session, which on a modest model can echo the injected context instead of
      // answering. Normal chat keeps its own per-thread memory.
      sessionKey: ctx.chatOnly
        ? `agent:main:web:ask:${ctx.userId}`
        : `agent:main:web:conv:${ctx.conversationId}`,
      userId: ctx.userId,
      // The thread so far, so the primary path has the same continuity the
      // gateway's session memory used to give only the fallback. Trimmed by
      // the loop; only role + content cross this seam.
      history: ctx.existing.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    }),
    enqueueProposalFromMessage(ctx.userId, ctx.text, new Date().toISOString()).catch(() => null),
  ]);
  const reply =
    (typeof loki.body.text === "string" && loki.body.text) ||
    (typeof loki.body.error === "string" ? loki.body.error : "Loki is unavailable right now.");
  const assistant = await addMessage(ctx.conversationId, {
    role: "assistant",
    kind: "chat",
    content: reply,
    meta: {
      projectKey: chatProject,
      // Provenance — which brain, which model, what was retrieved, which
      // tools ran, and whether the answer verified clean. Persisted whole:
      // this used to keep `model` and `sources` and drop `grounding`, so a
      // flagged answer reopened from history rendered as a clean one.
      ...pickProvenance(loki.body),
      // Persisted so a reopened thread can still resolve its citations. A
      // transcript that renders [F8] as a bare handle after reload would be
      // showing the operator a source they cannot reach.
      ...(Array.isArray(loki.body.sources) && loki.body.sources.length > 0
        ? { sources: loki.body.sources }
        : {}),
      ...(queued
        ? {
            queuedActionId: queued.id,
            queuedActionTitle: queued.title,
            queuedActionType: queued.type,
            // Whether it is waiting on the operator or already running —
            // the footer says different things, and saying the wrong one
            // sends them to approve something that needs no approval.
            queuedActionAutoApproved: queued.autoApproved,
          }
        : {}),
    },
  });
  if (chatProject) await linkProject(ctx, chatProject);
  return assistant;
}

/** The classifier path: dispatch, ask which project, or answer. */
async function resolveAndAnswer(ctx: TurnContext, emit: Emit): Promise<ConversationMessage> {
  const resolution: CommandResolution = ctx.chatOnly
    ? {
        kind: "chat",
        projectKey: ctx.selectedProjects[0] ?? null,
        intentId: null,
        prompt: ctx.text,
        needsProject: false,
        reason: "forced chat (proactive fleet review)",
      }
    : await resolveCommand(
        {
          text: ctx.text,
          projects: ctx.projectNames,
          selectedProject: ctx.selectedProjects[0],
        },
        ctx.userId,
      );

  const dispatchTargets = resolveDispatchTargets({
    resolution,
    selectedProjects: ctx.selectedProjects,
    namedInText: projectMentionedIn(ctx.text, ctx.projectNames),
  });

  if (resolution.kind === "command" && dispatchTargets.length > 0) {
    return dispatchResolvedCommand(ctx, resolution, dispatchTargets);
  }
  if (shouldAskForProject(resolution, ctx.projectNames)) return needsProjectReply(ctx, resolution);
  return chatReply(ctx, resolution, emit);
}

/** Persist the human turn, and title an untitled thread from its first line. */
async function persistUserTurn(
  userId: string,
  conversationId: string,
  existing: { conversation: Conversation; messages: ConversationMessage[] },
  text: string,
  attachmentNote: string,
) {
  await addMessage(conversationId, { role: "user", content: text + attachmentNote });
  const titleForAuto = existing.conversation.title.trim();
  if (
    existing.messages.length === 0 &&
    (titleForAuto === "" || titleForAuto === DEFAULT_CONVERSATION_TITLE)
  ) {
    const title = deriveConversationTitle(text);
    if (title) await updateConversationTitle(userId, conversationId, title);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const conversationId = idOrResp;

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const {
    text: rawText,
    selectedProjects,
    agent,
    model,
    attachments: rawAttachments,
    dispatchOnly,
    chatOnly,
  } = dataOrResp;
  const text = rawText.trim() || DEFAULT_VISION_QUESTION;
  const attachments = rawAttachments?.map(normalizeAttachment);
  const hasImages = (attachments ?? []).some((a) => a.kind === "image");
  const attachmentNote = attachmentNoteLabel(attachments);

  // Read the thread BEFORE opening the stream. Everything that can still answer
  // with a plain status code belongs on this side of the boundary — a 404
  // delivered as an SSE frame is a 200 as far as every caller and probe is
  // concerned.
  const existing = await getConversationWithMessages(userId, conversationId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return sseResponse<LokiStreamEvent>(
    encodeLokiEvent,
    async (emit) => {
      /** The persisted turn, as it goes over the wire. */
      const send = (m: ConversationMessage) =>
        emit({
          type: "message",
          message: {
            ...m,
            createdAt: m.createdAt.toISOString(),
            meta: m.meta ?? null,
          } as WireMessage,
        });

      // Describing an attached screenshot is a model call of its own and can take
      // seconds — named here rather than spent in silence.
      if (hasImages) emit({ type: "status", label: "reading-images" });
      const attachmentSuffix = await buildAttachmentSuffix(attachments, text);

      if (!dispatchOnly) {
        await persistUserTurn(userId, conversationId, existing, text, attachmentNote);
      }

      const projects = await getUserProjects(userId);
      const ctx: TurnContext = {
        userId,
        conversationId,
        existing,
        text,
        currentTitle: existing.conversation.title.trim(),
        projects,
        projectNames: projects.map((p) => p.name),
        selectedProjects,
        agent: agent as AdapterId | undefined,
        model,
        attachments,
        attachmentSuffix,
        hasImages,
        chatOnly: Boolean(chatOnly),
      };

      for (const fastPath of FAST_PATHS) {
        const answered = await fastPath(ctx);
        if (answered) return send(answered);
      }

      return send(await resolveAndAnswer(ctx, emit));
    },
    req.signal,
    (e) => ({
      type: "error",
      error: e instanceof Error ? e.message : "Loki could not finish this turn.",
    }),
  );
}
