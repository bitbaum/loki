/**
 * NL command resolution for the Loki command composer (SSOT).
 *
 * Turns a plain-language input into a routable decision, per the design in
 * docs/loki-command-surface.md and the operator's calls:
 *   - chat vs command: route each input to one or the other.
 *   - ask when ambiguous: a command with no resolvable project sets
 *     needsProject=true so the UI asks instead of guessing.
 *   - dispatch is fire-and-forget into the project's session (the caller posts
 *     to /api/inject); this resolver only RESOLVES, it does not dispatch.
 *
 * Resolution is one fast Groq call, with a deterministic fallback (the shared
 * project-mention matcher, treat as command) when the LLM is unavailable — so
 * the composer degrades to "named project → run", never to a hang.
 *
 * This is the single resolver shared by /api/command/resolve and the Loki
 * /api/conversations/[id]/messages route — neither keeps its own copy.
 */
import { callGroqText } from "@/lib/groq";
import { projectMentionedIn } from "@/lib/project-mention";
import { ORCHESTRATION_TASK_INTENT_IDS, type OrchestrationTaskIntentId } from "@/lib/orchestration";

export type CommandResolution = {
  kind: "command" | "chat";
  projectKey: string | null;
  intentId: OrchestrationTaskIntentId | null;
  prompt: string;
  needsProject: boolean;
  reason: string;
};

export type ResolveCommandInput = {
  text: string;
  projects: string[];
  selectedProject?: string;
};

const SYSTEM = `You route an operator's input in a multi-project AI-agent console. Return ONLY compact JSON with keys: kind, projectKey, intentId, prompt, reason.
- kind: "command" if they want an agent to DO work on a project — including when they're done discussing and ready to build ("let's develop", "build it", "implement this", "start coding", "ship it", "make it happen", "go ahead"); "chat" if they're asking a question or still exploring ideas without asking to run work.
- projectKey: the EXACT project name (copied verbatim from the provided list) the input refers to, or null if none is named. NEVER invent a name that is not in the list.
- intentId: one of [${ORCHESTRATION_TASK_INTENT_IDS.join(", ")}] when the request clearly maps to one, else null. Hints: "code review"->quality; "review the ui"/"ux"->ux_review; "run tests"/"fix types"/"fix tests"->test_and_fix; "commit"/"push"->commit_push; "audit"/"full audit"->full_audit; "what next"/"keep going"/"next best"/"let's develop"/"build it"/"implement"->next_best; "deploy check"->deploy_check; "product review"->product; "wrap up"/"close"->close_session.
- prompt: the cleaned instruction to give the agent (for command) or the user's message (for chat), with the project name removed. For develop/build handoffs, include the concrete task from the message (or "Continue from our discussion and implement the plan we agreed.").
- reason: <= 8 words.`;

/** Phrases that mean "stop talking, start building" — deterministic fast path. */
const DEVELOP_READY_RE =
  /\b(let['']?s|time to|ready to|go ahead(?: and)?|please|now)\s+(develop|build|implement|code|ship|make it|start(?:\s+coding)?)\b|\b(start|begin)\s+(develop(?:ment|ing)?|building|implement(?:ation|ing)?|coding)\b/i;

/** Imperative work — route to dispatch when a project is in context (not Q&A). */
const ACTION_VERB_RE =
  /\b(implement|fix|add|build|ship|refactor|rewrite|migrate|update|write|create|patch|debug|investigate|optimize|remove|delete|integrate|wire|configure|set up|hook up|continue|keep going|move forward|make progress|next step|next best)\b/i;

const CHAT_QUESTION_RE =
  /^(what|why|how|when|where|who|should|could|would|can you explain|tell me about|describe|compare|summarize|explain|list|show me|is there|are there)\b/i;

/**
 * Asking to be TOLD something. Not every request phrased as an instruction is
 * work for an agent — "I want you to tell me what is left to do with X" is a
 * question wearing an imperative coat, and CHAT_QUESTION_RE misses it because
 * the sentence opens with "I", not an interrogative.
 *
 * This mattered because the fallback at the bottom of looksLikeDispatchTask
 * treats any sentence over 16 characters containing " for "/" on "/" in " as a
 * task. That sentence contains "for it", so a plain question was routed to an
 * agent, and — having no project — came back as a picker instead of an answer.
 * Read the room before reading the grammar: if they asked to be told, tell them.
 */
const INFO_REQUEST_RE =
  /^\s*(?:so\s+|and\s+|ok(?:ay)?,?\s+)?(?:i\s+(?:just\s+)?(?:want|need|would\s+like|'?d\s+like|wanna)\s+(?:you\s+)?to\s+(?:tell|explain|show|describe|summari[sz]e|list|walk|say)|i\s+(?:want|need|'?d\s+like)\s+to\s+(?:know|understand|see|hear)|(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:tell|explain|show|describe|summari[sz]e|list|walk|remind|give)|tell\s+me|remind\s+me|walk\s+me\s+through|give\s+me\s+(?:a\s+|an\s+|the\s+)?(?:summary|rundown|status|overview|list|sense|picture|breakdown)|any\s+(?:idea|thoughts|update)|status\s+(?:of|on)\b)/i;

/**
 * A yes/no question — "Are you able to…", "Is it possible…", "Do you know…".
 *
 * Observed 2026-10-05: "Are you able to work on improving Loki in this field."
 * opened with none of CHAT_QUESTION_RE's words, carried no keyword verb, and
 * has no question mark (voice input drops it) — so it reached the last-resort
 * rule below, which reads " on " as a task, and an agent was queued to answer
 * a question about whether it could. Auxiliary-led sentences ask; they do not
 * order. "can/could/will you <verb>" is deliberately absent: that is how people
 * politely give an instruction, and ACTION_VERB_RE decides those.
 */
const YES_NO_QUESTION_RE =
  /^(?:so\s+|and\s+|ok(?:ay)?,?\s+)?(?:are|is|am|was|were|do|does|did|have|has|had|may|might|shall)\s+(?:you|it|there|this|that|we|i|they|loki|anything|everything)\b|^(?:can|could|would|will)\s+(?:you|it|loki)\s+(?:be\s+able|even|actually|really|ever)\b/i;

function inferIntentFromText(text: string): OrchestrationTaskIntentId | null {
  const t = text.toLowerCase();
  if (/\b(code review|review (?:the )?code)\b/.test(t)) return "quality";
  if (/\b(review (?:the )?ui|ux review)\b/.test(t)) return "ux_review";
  if (/\b(fix (?:types|tests)|run tests|test_and_fix)\b/.test(t)) return "test_and_fix";
  if (/\b(commit|push)\b/.test(t)) return "commit_push";
  if (/\b(full audit|audit the)\b/.test(t)) return "full_audit";
  if (/\b(deploy check|deploy)\b/.test(t)) return "deploy_check";
  if (/\b(next best|keep going|continue|move forward|make progress|develop|build it)\b/.test(t)) {
    return "next_best";
  }
  return null;
}

/** Asked to be told, not to have something done — whatever else it contains. */
function readsAsQuestion(t: string): boolean {
  return (
    CHAT_QUESTION_RE.test(t) ||
    INFO_REQUEST_RE.test(t) ||
    YES_NO_QUESTION_RE.test(t) ||
    (t.endsWith("?") && !ACTION_VERB_RE.test(t))
  );
}

/** True when the message is work to run, not a question for Loki chat. */
export function looksLikeDispatchTask(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // An explicit build handoff outranks everything — "ok, now please build it".
  if (DEVELOP_READY_RE.test(t)) return true;
  if (CHAT_QUESTION_RE.test(t)) return false;
  if (INFO_REQUEST_RE.test(t)) return false;
  if (YES_NO_QUESTION_RE.test(t)) return false;
  if (t.endsWith("?") && !ACTION_VERB_RE.test(t)) return false;
  if (ACTION_VERB_RE.test(t)) return true;
  // Last resort: a bare "<project>: <thing>" or "ship the parser for X" with no
  // recognised verb. Deliberately narrower than "contains a preposition" — that
  // version swallowed ordinary sentences whole. The text must still READ as an
  // instruction, i.e. start with a word that could be a verb, not with a
  // pronoun or an article.
  if (/^(i|we|you|it|they|he|she|the|a|an|my|our|this|that|there|here)\b/i.test(t)) return false;
  return t.length >= 16 && /\b(for|on|in)\s+\S/.test(t);
}

/** True when the operator gave a short generic handoff ("let's develop it") — use
 *  the intent's orchestration template instead of the literal phrase as customPrompt. */
export function isGenericDevelopHandoff(text: string): boolean {
  return DEVELOP_READY_RE.test(text) && text.trim().length < 48;
}

/**
 * Resolve a natural-language input into a routable {@link CommandResolution}.
 * Resolution is currently stateless; the route callers pass userId at the HTTP
 * boundary (auth + scoping) and a future revision can bias by recent/active
 * project, so the param is reserved here without being consumed yet.
 */
function pickProjectKey(
  projects: string[],
  namedInText: string | null,
  selectedProject?: string,
  /** When true, a sole registered project is enough context for a develop handoff. */
  allowSingleProject = false,
): string | null {
  return (
    namedInText ??
    selectedProject ??
    (allowSingleProject && projects.length === 1 ? projects[0] : null)
  );
}

export async function resolveCommand(
  { text, projects, selectedProject }: ResolveCommandInput,
  userId?: string,
): Promise<CommandResolution> {
  void userId; // reserved for per-user biasing; see doc comment.
  // Spacing- and case-tolerant: "Orange Cat" resolves the registered `orangecat`.
  const namedInText = projectMentionedIn(text, projects);

  // Fast path — "let's develop it" with a known project should dispatch, not chat.
  if (DEVELOP_READY_RE.test(text)) {
    const projectKey = pickProjectKey(projects, namedInText, selectedProject, true);
    return {
      kind: "command",
      projectKey,
      intentId: "next_best",
      prompt: text,
      needsProject: !projectKey,
      reason: "develop handoff",
    };
  }

  // Fast path — imperative task with project context → dispatch, not Loki chat.
  if (looksLikeDispatchTask(text)) {
    const projectKey = pickProjectKey(projects, namedInText, selectedProject, true);
    if (projectKey) {
      return {
        kind: "command",
        projectKey,
        intentId: inferIntentFromText(text),
        prompt: text,
        needsProject: false,
        reason: "action task",
      };
    }
  }

  try {
    const out = await callGroqText(
      `Projects: ${JSON.stringify(projects)}\nCurrently selected project: ${selectedProject ?? "none"}\nInput: ${text}`,
      {
        feature: "command-resolve",
        systemPrompt: SYSTEM,
        maxTokens: 220,
        temperature: 0,
        timeoutMs: 8000,
      },
    );
    const raw = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as Record<
      string,
      unknown
    >;

    const llmProject =
      typeof raw.projectKey === "string" && projects.includes(raw.projectKey)
        ? raw.projectKey
        : null;
    const projectKey = pickProjectKey(projects, llmProject ?? namedInText, selectedProject);
    const intentId =
      typeof raw.intentId === "string" &&
      (ORCHESTRATION_TASK_INTENT_IDS as readonly string[]).includes(raw.intentId)
        ? (raw.intentId as OrchestrationTaskIntentId)
        : null;
    const kind = raw.kind === "chat" ? "chat" : "command";
    const prompt = typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : text;

    return {
      kind,
      projectKey,
      intentId,
      prompt,
      needsProject: kind === "command" && !projectKey,
      reason: typeof raw.reason === "string" ? raw.reason.slice(0, 60) : "",
    };
  } catch {
    // LLM unavailable → degrade to a deterministic command: project from the
    // text or the current selection; ask if neither. A question stays a
    // question — queueing an agent to answer "are you able to…?" is the one
    // degradation worse than a slower answer.
    const projectKey = pickProjectKey(projects, namedInText, selectedProject);
    if (readsAsQuestion(text.trim())) {
      return {
        kind: "chat",
        projectKey,
        intentId: null,
        prompt: text,
        needsProject: false,
        reason: "question (no llm)",
      };
    }
    return {
      kind: "command",
      projectKey,
      intentId: null,
      prompt: text,
      needsProject: !projectKey,
      reason: "deterministic (no llm)",
    };
  }
}
