/**
 * Deterministic fleet-aware NL handlers for the Loki messages route.
 * These run before resolveCommand() so "list my projects" and "create project X"
 * never hit OpenClaw web search or a mis-routed dispatch.
 */
import type { UserProject } from "@/db/schema";
import { normalizeProjectName } from "@/lib/project-name";
import { projectMentionedIn } from "@/lib/project-mention";

const LIST_PROJECTS_RE =
  /\b(list|show|name|tell me)\b.*\b(my )?(projects?|fleet)\b|\b(what|which)\s+projects?\b|\bprojects?\s+do\s+i\s+have\b/i;

const CREATE_WITH_NAME_RE =
  /\bcreate(?:\s+a|\s+an|\s+the|\s+new)?\s+(?:project|entity)(?:\s+(?:called|named|for))?\s+(.+)/i;

const CREATE_GENERIC_RE =
  /\bcreate(?:\s+a|\s+an|\s+the|\s+new)?\s+(?:project|entity)\b(?:\s+and\b|\s*$)/i;

const DISPATCH_AFTER_CREATE_RE =
  /\b(let['']?s|and)\s+(go|develop|build|start|dispatch|run)\b|\bgo ahead\b/i;

export function isListProjectsQuery(text: string): boolean {
  return LIST_PROJECTS_RE.test(text.trim());
}

export function formatProjectList(projects: UserProject[]): string {
  if (projects.length === 0) {
    return "You don't have any projects yet. Say **create project my-app** to register one.";
  }
  const lines = projects.map((p) => `- **${p.name}**${p.description ? ` — ${p.description}` : ""}`);
  return [
    `Your fleet (${projects.length} project${projects.length === 1 ? "" : "s"}):`,
    "",
    ...lines,
    "",
    "Select one on the right, name it in your message, or say **code review for `<project>`**.",
  ].join("\n");
}

export type CreateProjectRequest = {
  /** Normalized slug when the user named it; null when they said "create entity and go". */
  name: string | null;
  dispatchAfter: boolean;
  /**
   * What to build, when the line carries it: "create project plant-log and
   * build it: a page that logs watering". Loki ends a scoping answer with
   * exactly that line, so the scope it just wrote reaches the agent instead of
   * a bare "continue from our discussion" the agent has never seen.
   */
  task: string | null;
};

const CREATE_TASK_RE =
  /\b(?:and|then|let['']?s)\s+(?:go|develop|build|start|dispatch|run)(?:\s+it)?\s*[:\u2014-]\s*([\s\S]{8,})$/i;

function createTask(text: string): string | null {
  return text.match(CREATE_TASK_RE)?.[1]?.trim().replace(/\*+$/, "").trim() || null;
}

export function parseCreateProjectRequest(text: string): CreateProjectRequest | null {
  const trimmed = text.trim();
  const named = trimmed.match(CREATE_WITH_NAME_RE);
  if (named) {
    const raw = named[1].replace(/\s+(and|then)\s+.*$/i, "").trim();
    const slug = normalizeProjectName(raw);
    if (!slug) return null;
    return {
      name: slug,
      dispatchAfter: DISPATCH_AFTER_CREATE_RE.test(trimmed),
      task: createTask(trimmed),
    };
  }
  if (CREATE_GENERIC_RE.test(trimmed)) {
    return {
      name: null,
      dispatchAfter: DISPATCH_AFTER_CREATE_RE.test(trimmed),
      task: createTask(trimmed),
    };
  }
  return null;
}

/** Fallback name when the user says "create entity and go" without naming it. */
export function projectNameFromConversationTitle(title: string): string | null {
  const slug = normalizeProjectName(title);
  return slug || null;
}

/**
 * Which fleet project a fast path applies to: a project NAMED in the message
 * first, then the selection.
 *
 * It was selection first. But the selection is no longer an explicit pick:
 * after every answer it follows the project that answer used, so in one chat
 * that moves between projects, "write the business plan for orangecat" sent
 * after a loki build went to loki. The main path already lets the name win
 * (resolveDispatchTargets); the fast paths now agree with it.
 */
export function resolveFleetCommandProjectKey(
  text: string,
  selectedProject: string | undefined,
  projectNames: string[],
): string | null {
  return projectMentionedIn(text, projectNames) ?? (selectedProject || null);
}

const BUSINESS_PLAN_VERB_RE =
  /\b(generate|write|create|refresh|update|iterate|regenerate|draft|build)\b/i;
const BUSINESS_PLAN_NOUN_RE = /\b(business\s+plan|living\s+business\s+plan)\b/i;

export function isBusinessPlanRequest(text: string): boolean {
  const t = text.trim();
  return BUSINESS_PLAN_VERB_RE.test(t) && BUSINESS_PLAN_NOUN_RE.test(t);
}

const DEVELOP_ALL_FLEET_RE =
  /\b(develop|build|kick|start|run)\b[\s\S]{0,48}\b(all|every|whole|entire)\b[\s\S]{0,24}\b(projects?|fleet)\b|\b(all|every)\b[\s\S]{0,32}\b(projects?|fleet)\b[\s\S]{0,24}\b(develop|build|kick|start|run)\b|\bbuild\b[\s\S]{0,24}\bfleet\b/i;

/** "Develop all my projects" / "build the whole fleet" — batch fleet-kick. */
export function isDevelopAllFleetRequest(text: string): boolean {
  return DEVELOP_ALL_FLEET_RE.test(text.trim());
}

const MOVE_FORWARD_READY_RE =
  /\b(let['']?s|time to|ready to|go ahead(?: and)?|please|now)\s+(develop|build|implement|code|ship|make it|start(?:\s+coding)?)\b/i;

const MOVE_FORWARD_RE =
  /\b(move forward|make progress|keep (?:building|going)|push (?:ahead|forward)|start building|get (?:it|this) (?:done|shipped)|work on (?:this|it|them))\b/i;

/** Single-project or fleet progress without naming "all projects". */
export function isMoveForwardRequest(text: string): boolean {
  const t = text.trim();
  if (isDevelopAllFleetRequest(t)) return false;
  return MOVE_FORWARD_RE.test(t) || MOVE_FORWARD_READY_RE.test(t);
}

/** Writable profile fields Loki may propose — keys match attributes or entity.description. */
export const PROFILE_FIELD_ALIASES: Record<string, string> = {
  mission: "mission",
  vision: "vision",
  stack: "stack",
  customers: "customers",
  architecture: "architecture",
  convention: "conventions",
  conventions: "conventions",
  "definition of done": "definition_of_done",
  definition_of_done: "definition_of_done",
  dod: "definition_of_done",
  "next step": "next_step",
  next_step: "next_step",
  description: "description",
  status: "status",
  maturity: "maturity",
};

export const PROFILE_FIELD_LABELS: Record<string, string> = {
  mission: "Mission",
  vision: "Vision",
  stack: "Stack",
  customers: "Customers",
  architecture: "Architecture",
  conventions: "Conventions",
  definition_of_done: "Definition of done",
  next_step: "Next step",
  description: "Description",
  status: "Status",
  maturity: "Maturity",
};

const PROFILE_UPDATE_RE =
  /\b(?:update|set|change)\s+(?:the\s+)?([a-z][\w\s]{0,28}?)\s+(?:to|as|for|:|=)\s+([\s\S]+)/i;

export type ProfileUpdateRequest = {
  fieldKey: string;
  value: string;
};

function trimQuotedValue(raw: string): string {
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v.replace(/\s+$/, "");
}

function resolveProfileField(raw: string): string | null {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return PROFILE_FIELD_ALIASES[normalized] ?? null;
}

/** Parse "set mission to …" / "update stack: …" when a known profile field is named. */
export function parseProfileUpdateRequest(text: string): ProfileUpdateRequest | null {
  if (isBusinessPlanRequest(text)) return null;

  const match = text.trim().match(PROFILE_UPDATE_RE);
  if (!match) return null;

  const fieldKey = resolveProfileField(match[1]);
  if (!fieldKey) return null;

  const value = trimQuotedValue(match[2]).slice(0, 4000);
  if (!value) return null;

  return { fieldKey, value };
}
