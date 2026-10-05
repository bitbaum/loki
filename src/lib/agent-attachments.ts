/**
 * Screenshots that reach the agent AS IMAGES.
 *
 * Claude Code (and the other terminal agents) read an image file when the
 * prompt names its path — the model sees the pixels. What it cannot do is see
 * a picture that only exists in the browser that attached it. So an image
 * travels with the command (cloud → runner, durable pending_commands), the
 * RUNNER writes it to a file on the machine where the agent runs, and the
 * prompt's placeholder becomes that file's absolute path before it is typed.
 *
 * This replaced describing the screenshot with a free vision model first: when
 * those were rate-limited (HTTP 429) the agent got "could not analyse" instead
 * of the picture (2026-10-05) — and even when they answered, the agent read a
 * paraphrase, not the screen.
 *
 * Pure (no fs): shared by the web routes that stage images and the runner that
 * resolves them. Writing the files is agent-attachments-fs.ts.
 */

/** One image staged for an agent. `id` names the file and the placeholder. */
export type AgentImage = { id: string; name: string; mimeType: string; dataBase64: string };

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
/** One screenshot of a phone is well under this; it bounds the command row. */
export const MAX_AGENT_IMAGE_BASE64 = 5_500_000;
export const MAX_AGENT_IMAGES = 5;

const TOKEN_RE = /\{\{loki-attachment:([0-9a-f-]{36})\}\}/g;
export const attachmentToken = (id: string) => `{{loki-attachment:${id}}}`;

/** The file extension for an accepted image type, or null for anything else. */
export function imageExtension(mimeType: string): string | null {
  return EXT[mimeType.toLowerCase()] ?? null;
}

/** The prompt with a line per image naming its placeholder, for the runner to
 *  turn into a path. The instruction is explicit: an agent that is merely told
 *  a path exists may not open it. */
export function withImageTokens(prompt: string, images: readonly AgentImage[]): string {
  if (images.length === 0) return prompt;
  const lines = images.map((img) => `- ${img.name}: ${attachmentToken(img.id)}`);
  return `${prompt}\n\nAttached screenshot${images.length > 1 ? "s" : ""} — open each image file and look at it before you act:\n${lines.join("\n")}`;
}

/** Placeholders → absolute paths. A placeholder with no file (it could not be
 *  written) says so in words rather than leaving a token the agent would
 *  puzzle over. */
export function resolveImageTokens(prompt: string, paths: ReadonlyMap<string, string>): string {
  return prompt.replace(
    TOKEN_RE,
    (_, id: string) => paths.get(id) ?? "(this screenshot could not be delivered)",
  );
}

/**
 * The runner's boundary check: a payload's `attachments`, if present, must be
 * a short list of well-formed images. Anything else is refused whole — a
 * half-accepted list would send a prompt pointing at files that do not exist.
 */
export function parseAgentImages(
  value: unknown,
): { ok: true; images: AgentImage[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, images: [] };
  if (!Array.isArray(value) || value.length > MAX_AGENT_IMAGES) {
    return { ok: false, error: `attachments must be a list of at most ${MAX_AGENT_IMAGES} images` };
  }
  const images: AgentImage[] = [];
  for (const raw of value) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const { id, name, mimeType, dataBase64 } = r;
    if (typeof id !== "string" || !ID_RE.test(id))
      return { ok: false, error: "attachment id must be a uuid" };
    if (typeof name !== "string" || name.length === 0 || name.length > 200) {
      return { ok: false, error: "attachment name must be 1–200 characters" };
    }
    if (typeof mimeType !== "string" || !imageExtension(mimeType)) {
      return { ok: false, error: "attachment must be a png, jpeg, gif or webp image" };
    }
    if (
      typeof dataBase64 !== "string" ||
      dataBase64.length === 0 ||
      dataBase64.length > MAX_AGENT_IMAGE_BASE64
    ) {
      return { ok: false, error: "attachment data missing or too large" };
    }
    images.push({ id, name, mimeType, dataBase64 });
  }
  return { ok: true, images };
}
