/**
 * What a repository's agent files say about it, for profile enrichment.
 *
 * Fleet repos keep their agent notes in AGENTS.md; CLAUDE.md there is a
 * pointer to it ("Read [AGENTS.md](AGENTS.md)", "@AGENTS.md", or an
 * `@.claude/CLAUDE.md` import), which on its own tells the model nothing.
 * So AGENTS.md is read first, a pointer is followed to the file it names, and
 * a repo outside the fleet that keeps real notes in CLAUDE.md still has them
 * read.
 */
import { posix } from "path";

/** Reads a repo-relative path; null when the file does not exist. */
export type ReadRepoFile = (path: string) => Promise<string | null>;

export interface AgentDoc {
  /** Repo-relative path, e.g. "AGENTS.md" or ".claude/CLAUDE.md". */
  label: string;
  text: string;
}

/** A file this short, once its import lines are gone, is a pointer if it names a target. */
const POINTER_MAX_CHARS = 600;
const MAX_DEPTH = 3;
const IMPORT_LINE = /^@(\S+\.md)\s*$/;
const LOCAL_LINK = /\]\(((?!https?:|#|mailto:)[^)\s]+\.md)\)/g;
const AGENT_FILE = /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/;

/** Local agent files a document points at: `@path` imports and links to AGENTS.md / CLAUDE.md. */
export function pointerTargets(text: string, fromPath: string): string[] {
  const dir = posix.dirname(fromPath);
  const raw: string[] = [];
  for (const line of text.split("\n")) {
    const m = IMPORT_LINE.exec(line.trim());
    if (m) raw.push(m[1]);
  }
  for (const m of text.matchAll(LOCAL_LINK)) {
    if (AGENT_FILE.test(m[1])) raw.push(m[1]);
  }
  const resolved = raw
    .map((p) => posix.normalize(posix.join(dir, p)))
    .filter((p) => !p.startsWith("..") && !p.startsWith("/"));
  return [...new Set(resolved)];
}

/** The document minus its import lines and headings — what it says in its own words. */
function ownWords(text: string): string {
  return text
    .split("\n")
    .filter((line) => !IMPORT_LINE.test(line.trim()) && !/^\s*#/.test(line))
    .join("\n")
    .trim();
}

/** True when the document only points at other agent files. */
export function isPointer(text: string, fromPath: string): boolean {
  return pointerTargets(text, fromPath).length > 0 && ownWords(text).length < POINTER_MAX_CHARS;
}

/**
 * CLAUDE.md as enrichment source: null when it only points elsewhere.
 * Kept for callers that already hold the text and read AGENTS.md themselves.
 */
export function agentNotes(claudeMd: string | null, path = "CLAUDE.md"): string | null {
  if (!claudeMd) return null;
  return isPointer(claudeMd, path) ? null : claudeMd;
}

/**
 * The repo's agent notes, AGENTS.md first.
 *
 * CLAUDE.md is read after it; when it is a pointer, the files it names are
 * read instead (one AGENTS.md is never read twice). When neither root file
 * exists, `.claude/CLAUDE.md` is the fallback.
 */
export async function readAgentDocs(read: ReadRepoFile): Promise<AgentDoc[]> {
  const docs: AgentDoc[] = [];
  const seen = new Set<string>();

  async function visit(path: string, depth: number): Promise<void> {
    if (seen.has(path) || depth > MAX_DEPTH) return;
    seen.add(path);
    const text = (await read(path))?.trim();
    if (!text) return;
    if (isPointer(text, path)) {
      for (const target of pointerTargets(text, path)) await visit(target, depth + 1);
      return;
    }
    docs.push({ label: path, text });
  }

  await visit("AGENTS.md", 0);
  await visit("CLAUDE.md", 0);
  if (docs.length === 0) await visit(".claude/CLAUDE.md", 0);
  return docs;
}
