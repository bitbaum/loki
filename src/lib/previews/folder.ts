/**
 * The files Loki itself keeps in a preview folder, beside the site's own.
 *
 * `.loki/` is Loki's: the source the preview was made from, and the pictures
 * it takes for the tour. It is git-ignored at creation (lib/previews/create),
 * never served (lib/previews/serve refuses dot segments), and does not travel
 * when the folder becomes a repository. improvements.json is the agent's and
 * stays in the site's history.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  IMPROVEMENTS_FILE,
  LOKI_DIR,
  SOURCE_FILE,
  parseImprovements,
  parsePreviewSource,
  type Improvements,
  type PreviewSource,
} from "@/lib/previews/improvements";

export async function readPreviewSource(dir: string): Promise<PreviewSource | null> {
  const raw = await readFile(path.join(dir, SOURCE_FILE), "utf8").catch(() => null);
  return parsePreviewSource(raw);
}

export async function writePreviewSource(dir: string, source: PreviewSource): Promise<void> {
  await mkdir(path.join(dir, LOKI_DIR), { recursive: true });
  await writeFile(path.join(dir, SOURCE_FILE), `${JSON.stringify(source, null, 2)}\n`);
}

export async function readImprovements(dir: string): Promise<Improvements | null> {
  const raw = await readFile(path.join(dir, IMPROVEMENTS_FILE), "utf8").catch(() => null);
  return parseImprovements(raw);
}
