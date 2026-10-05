/**
 * Claude Code's session log, read as a conversation.
 *
 * Claude Code writes every session to ~/.claude/projects/<slug>/<id>.jsonl,
 * one JSON object per line. /terminal used to show only the PTY — Claude's
 * answers as 80-column TUI cells, unreadable on a phone. The log already holds
 * the same conversation as structured data: what you typed, what Claude said,
 * every tool it ran and what came back. This turns those lines into chat items
 * a phone can render as messages.
 *
 * Pure: no fs, no React. The runner (desktop/src/main/transcript-streamer.ts)
 * feeds it lines as the file grows and posts the items it yields; the browser
 * merges them by id. A tool's result arrives on a LATER line than its call, so
 * the reducer keeps a little state and re-emits the tool item when its result
 * lands — the browser's upsert replaces the "running" row with the finished one.
 */

/** One row in the rendered conversation. */
export type TranscriptItem =
  | {
      id: string;
      at: string | null;
      kind: "user";
      text: string;
      /** Claude Code's permission mode when this message was sent
       *  (`permissionMode` on the log line). Absent from older runners/logs. */
      mode?: string;
    }
  | { id: string; at: string | null; kind: "assistant"; text: string }
  | {
      id: string;
      at: string | null;
      kind: "tool";
      name: string;
      /** One line saying what the call touches: a command, a path, a pattern. */
      summary: string;
      status: "running" | "done" | "error";
      /** The result's first lines, for an expandable row. Never the whole thing. */
      result: string | null;
    };

/** Per-file reducer state. */
export type TranscriptState = {
  /** tool_use id → the item last emitted for it, so a result can update it. */
  tools: Map<string, Extract<TranscriptItem, { kind: "tool" }>>;
};

export function newTranscriptState(): TranscriptState {
  return { tools: new Map() };
}

/** Results and summaries are previews; a 2MB file read must not cross the wire. */
const RESULT_PREVIEW_CHARS = 1200;
const SUMMARY_CHARS = 160;
/** A single message can be long, but not unbounded. */
const TEXT_CHARS = 20_000;

type Block = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

type Line = {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  permissionMode?: string;
  message?: { role?: string; content?: string | Block[] };
};

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Text of a tool_result's `content`, which is a string or a list of blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && typeof (b as Block).text === "string"
          ? (b as Block).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** What a tool call touches, in one line. Falls back to its first string arg. */
export function summariseToolInput(
  name: string,
  input: Record<string, unknown> | undefined,
): string {
  const str = (k: string) => (typeof input?.[k] === "string" ? (input[k] as string) : "");
  const pick =
    (name === "Bash" && str("command")) ||
    str("file_path") ||
    str("path") ||
    str("pattern") ||
    str("url") ||
    str("query") ||
    str("description") ||
    str("prompt") ||
    Object.values(input ?? {}).find((v): v is string => typeof v === "string") ||
    "";
  return clip(pick.replace(/\s+/g, " ").trim(), SUMMARY_CHARS);
}

/**
 * Lines Claude Code writes that are not conversation: slash-command
 * bookkeeping, local command output, interrupt markers. Shown, they read as
 * noise the person never typed.
 */
function isHarnessText(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith("<command-name>") ||
    t.startsWith("<command-message>") ||
    t.startsWith("<local-command-stdout>") ||
    t.startsWith("<system-reminder>") ||
    t.startsWith("Caveat: The messages below were generated")
  );
}

/**
 * Reduce one JSONL line to the items it adds or updates. Malformed lines,
 * sidechains (subagent traffic), meta lines and summaries yield nothing.
 */
export function reduceTranscriptLine(state: TranscriptState, raw: string): TranscriptItem[] {
  let line: Line;
  try {
    line = JSON.parse(raw) as Line;
  } catch {
    return [];
  }
  if (!line || typeof line !== "object" || line.isSidechain || line.isMeta) return [];
  if (line.type !== "user" && line.type !== "assistant") return [];
  const base = line.uuid ?? "";
  if (!base) return [];
  const at = typeof line.timestamp === "string" ? line.timestamp : null;
  const content = line.message?.content;
  const mode =
    line.type === "user" && typeof line.permissionMode === "string"
      ? line.permissionMode.slice(0, 40)
      : undefined;
  const text = (kind: "user" | "assistant", id: string, body: string): TranscriptItem =>
    kind === "user" && mode
      ? { id, at, kind, text: clip(body, TEXT_CHARS), mode }
      : { id, at, kind, text: clip(body, TEXT_CHARS) };

  if (typeof content === "string") {
    if (!content.trim() || isHarnessText(content)) return [];
    return [text(line.type, base, content)];
  }
  if (!Array.isArray(content)) return [];

  const out: TranscriptItem[] = [];
  content.forEach((block, i) => {
    if (!block || typeof block !== "object") return;
    if (block.type === "text" && typeof block.text === "string") {
      if (!block.text.trim() || isHarnessText(block.text)) return;
      out.push(text(line.type as "user" | "assistant", `${base}:${i}`, block.text));
      return;
    }
    if (block.type === "tool_use" && typeof block.id === "string") {
      const item: Extract<TranscriptItem, { kind: "tool" }> = {
        id: block.id,
        at,
        kind: "tool",
        name: block.name ?? "tool",
        summary: summariseToolInput(block.name ?? "", block.input),
        status: "running",
        result: null,
      };
      state.tools.set(block.id, item);
      out.push(item);
      return;
    }
    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      const prior = state.tools.get(block.tool_use_id);
      if (!prior) return; // its call scrolled out of the window we read
      const updated: Extract<TranscriptItem, { kind: "tool" }> = {
        ...prior,
        status: block.is_error ? "error" : "done",
        result: clip(resultText(block.content).trim(), RESULT_PREVIEW_CHARS) || null,
      };
      state.tools.set(block.tool_use_id, updated);
      out.push(updated);
    }
    // thinking / image / unknown blocks: not shown in the conversation view.
  });
  return out;
}

/** Fold a batch of updates into a list, replacing by id and keeping order. */
export function mergeTranscriptItems(
  list: TranscriptItem[],
  updates: TranscriptItem[],
): TranscriptItem[] {
  if (updates.length === 0) return list;
  const index = new Map(list.map((item, i) => [item.id, i]));
  const next = list.slice();
  for (const u of updates) {
    const at = index.get(u.id);
    if (at === undefined) {
      index.set(u.id, next.length);
      next.push(u);
    } else {
      next[at] = u;
    }
  }
  return next;
}

/**
 * Is Claude waiting on a person? True when the newest item is a tool call
 * with no result — Claude Code asks before running anything outside its
 * allowlist and records nothing until it is answered. Not proof (a slow
 * command looks the same), so the UI words it as a question and offers keys.
 */
export function looksBlockedOnApproval(items: TranscriptItem[]): boolean {
  const last = items[items.length - 1];
  return !!last && last.kind === "tool" && last.status === "running";
}

/** What the conversation view draws: a message, or a run of tool calls folded
 *  into one line ("Ran 3 commands") the way a chat app folds its work log. */
export type TranscriptBlock =
  | { type: "message"; item: Extract<TranscriptItem, { kind: "user" | "assistant" }> }
  | { type: "tools"; id: string; items: Extract<TranscriptItem, { kind: "tool" }>[] };

export function groupTranscript(items: TranscriptItem[]): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  for (const item of items) {
    if (item.kind === "tool") {
      const last = out[out.length - 1];
      if (last?.type === "tools") last.items.push(item);
      else out.push({ type: "tools", id: item.id, items: [item] });
    } else {
      out.push({ type: "message", item });
    }
  }
  return out;
}

const TOOL_VERBS: Record<string, string> = {
  Bash: "Running",
  Edit: "Editing",
  MultiEdit: "Editing",
  Write: "Writing",
  Read: "Reading",
  Glob: "Finding",
  Grep: "Searching for",
  WebFetch: "Fetching",
  WebSearch: "Searching the web for",
  Task: "Delegating:",
};

/**
 * Claude Code's permission modes, in the words the Claude app uses. A mode
 * this table does not know is shown by its own name rather than hidden.
 */
const MODE_LABELS: Record<string, string> = {
  default: "Ask before edits",
  acceptEdits: "Accept edits",
  plan: "Plan",
  auto: "Auto",
  bypassPermissions: "Bypass permissions",
};

/** Shift+Tab: what Claude Code's TUI takes to move to the next mode. */
export const CYCLE_MODE_KEY = "\x1b[Z";

/**
 * The session's permission mode as of your last message, or null when the
 * log does not say (an older runner, or nothing sent yet).
 *
 * Only as of your last message: Claude Code records the mode on what you
 * send, not when you switch it, so a switch shows once you next write.
 */
export function sessionMode(items: TranscriptItem[]): { id: string; label: string } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "user" && item.mode) {
      return { id: item.mode, label: MODE_LABELS[item.mode] ?? item.mode };
    }
  }
  return null;
}

const DONE_VERBS: Record<string, string> = {
  Bash: "Ran",
  Edit: "Edited",
  MultiEdit: "Edited",
  Write: "Wrote",
  NotebookEdit: "Edited",
  Read: "Read",
  Glob: "Found",
  Grep: "Searched for",
  WebFetch: "Fetched",
  WebSearch: "Searched the web for",
  Task: "Delegated:",
};

/**
 * One tool call as a verb and what it touched — "Ran" + `git push`, the way
 * the Claude app writes a single step ("Ran cd /home/user/loki && git …").
 * A lone call used to read "Ran a command", which hid the one fact worth
 * reading. Split in two so the target can be set in mono and truncated alone.
 */
export function describeToolStep(tool: Extract<TranscriptItem, { kind: "tool" }>): {
  verb: string;
  target: string;
} {
  const verbs = tool.status === "running" ? TOOL_VERBS : DONE_VERBS;
  return {
    verb: verbs[tool.name] ?? (tool.status === "running" ? `Using ${tool.name}` : tool.name),
    target: tool.summary,
  };
}

/**
 * Seconds since `since`, as the Claude app shows a turn's age: "13 s", "2 min 5 s".
 * Null without a parseable start.
 */
export function turnElapsedLabel(since: string | null, now: number): string | null {
  if (!since) return null;
  const start = Date.parse(since);
  if (!Number.isFinite(start)) return null;
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  if (secs < 60) return `${secs} s`;
  const mins = Math.floor(secs / 60);
  return secs % 60 === 0 ? `${mins} min` : `${mins} min ${secs % 60} s`;
}

/** "Ran 2 commands, edited a file" — one line for a folded run of tools. */
export function describeToolRun(tools: Extract<TranscriptItem, { kind: "tool" }>[]): string {
  // Still running: say what is happening NOW, in its own words, the way a
  // person watching wants it — "Running git push", not "Ran a command".
  const live = tools[tools.length - 1];
  if (live?.status === "running") {
    const verb = TOOL_VERBS[live.name] ?? `Using ${live.name}`;
    return live.summary ? `${verb} ${live.summary}` : verb;
  }
  const count = (names: string[]) => tools.filter((t) => names.includes(t.name)).length;
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
  const commands = count(["Bash"]);
  const edits = count(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
  const reads = count(["Read", "Glob", "Grep", "LS"]);
  const web = count(["WebFetch", "WebSearch"]);
  const other = tools.length - commands - edits - reads - web;
  if (commands) parts.push(`ran ${plural(commands, "a command", "commands")}`);
  if (edits) parts.push(`edited ${plural(edits, "a file", "files")}`);
  if (reads) parts.push(`read ${plural(reads, "a file", "files")}`);
  if (web) parts.push(`searched the web${web > 1 ? ` ${web}×` : ""}`);
  if (other) parts.push(`used ${plural(other, "a tool", "tools")}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
