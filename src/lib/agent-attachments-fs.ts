import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { imageExtension, resolveImageTokens, type AgentImage } from "./agent-attachments";

/** Where staged screenshots live on the machine running the agent: outside any
 *  project checkout, so they never end up in a commit. */
export function agentAttachmentsDir(): string {
  return join(homedir(), ".loki", "attachments");
}

/**
 * Write each image to a file and return the prompt with its placeholders
 * replaced by those files' absolute paths. Runs where the agent runs (the box
 * runner, the desktop Fleet Runner, or a local Loki with its own PTYs). A file
 * that cannot be written becomes a sentence in the prompt, never a crash of the
 * delivery: the words still reach the agent.
 */
export function materializeImages(
  prompt: string,
  images: readonly AgentImage[],
  dir = agentAttachmentsDir(),
): string {
  if (images.length === 0) return prompt;
  const paths = new Map<string, string>();
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (e) {
    console.warn("[attachments] cannot create", dir, (e as Error).message);
    return resolveImageTokens(prompt, paths);
  }
  for (const img of images) {
    const ext = imageExtension(img.mimeType);
    if (!ext) continue;
    const path = join(dir, `${img.id}.${ext}`);
    try {
      writeFileSync(path, Buffer.from(img.dataBase64, "base64"), { mode: 0o600 });
      paths.set(img.id, path);
    } catch (e) {
      console.warn("[attachments] cannot write", path, (e as Error).message);
    }
  }
  return resolveImageTokens(prompt, paths);
}
