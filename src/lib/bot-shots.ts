/**
 * Pictures a bot's browser took, kept for a week and served by a name nobody
 * can guess.
 *
 * A chat thread shows a picture only from a web address (chatkit's Markdown
 * refuses data: URLs), so the picture has to live somewhere a thread can
 * point at. The name is 32 random hex characters: knowing it is the right to
 * see it, the same rule as a preview link. A picture can show a signed-in
 * page, so they are not listed anywhere, not kept past seven days, and the
 * folder is this server's alone.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SHOT_TTL_MS = 7 * 24 * 60 * 60_000;
/** A JPEG of one viewport is well under this; anything larger is not one of ours. */
export const SHOT_MAX_BYTES = 1_500_000;
const SHOT_MAX_FILES = 2_000;
const TOKEN = /^[0-9a-f]{32}$/;

function shotDir(): string {
  const base =
    process.env.LOKI_BOT_BROWSER_DIR?.trim() || path.join(os.tmpdir(), "loki-bot-browser");
  const dir = path.join(base, "shots");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function isShotToken(v: string): boolean {
  return TOKEN.test(v);
}

/** Which files are over: older than a week, or beyond the newest SHOT_MAX_FILES. Pure. */
export function shotsToDrop(
  files: readonly { name: string; mtimeMs: number }[],
  now: number,
  max = SHOT_MAX_FILES,
): string[] {
  const fresh = files.filter((f) => now - f.mtimeMs < SHOT_TTL_MS);
  const old = files.filter((f) => now - f.mtimeMs >= SHOT_TTL_MS).map((f) => f.name);
  const extra = [...fresh]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(max)
    .map((f) => f.name);
  return [...old, ...extra];
}

let lastSweep = 0;
async function sweep(dir: string, now: number): Promise<void> {
  if (now - lastSweep < 10 * 60_000) return;
  lastSweep = now;
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith(".jpg"));
  const files: { name: string; mtimeMs: number }[] = [];
  for (const name of names) {
    const st = await stat(path.join(dir, name)).catch(() => null);
    if (st) files.push({ name, mtimeMs: st.mtimeMs });
  }
  for (const name of shotsToDrop(files, now))
    await unlink(path.join(dir, name)).catch(() => undefined);
}

/** Keep a JPEG (base64) and return its name, or null when it cannot be kept. */
export async function saveShot(base64: string): Promise<string | null> {
  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0 || bytes.length > SHOT_MAX_BYTES) return null;
    const dir = shotDir();
    const token = randomBytes(16).toString("hex");
    await writeFile(path.join(dir, `${token}.jpg`), bytes, { mode: 0o600 });
    void sweep(dir, Date.now());
    return token;
  } catch {
    return null;
  }
}

export async function readShot(token: string): Promise<Buffer | null> {
  if (!isShotToken(token)) return null;
  const file = path.join(shotDir(), `${token}.jpg`);
  const st = await stat(file).catch(() => null);
  if (!st || Date.now() - st.mtimeMs >= SHOT_TTL_MS) return null;
  return readFile(file).catch(() => null);
}

/** The address a thread shows the picture from. */
export function shotUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/api/orangecat/shot/${token}`;
}
