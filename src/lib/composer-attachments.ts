import {
  AttachmentBodySchema,
  MAX_ATTACHMENTS,
  normalizeAttachment,
  renderTextAttachments,
  type ImageAttachment,
} from "@/lib/loki/attachments";
import { describeAttachedImages } from "@/lib/loki/vision";
import { withImageTokens, type AgentImage } from "@/lib/agent-attachments";
import { z } from "@/lib/api/route-helpers";

/**
 * Turning attachments into something a terminal agent can act on.
 *
 * A coding agent in a PTY cannot read pixels. So an attached screenshot is not
 * forwarded — it is DESCRIBED first (the same vision preflight Loki uses) and
 * the description is folded into the prompt as text. That is what makes "send
 * a picture to an agent" a real feature rather than an upload button that
 * quietly drops the file: what arrives is a paragraph about the bug in the
 * screenshot, which is the thing the agent can act on.
 *
 * This lives in one place because dispatch does not. Control sends through
 * /api/orchestration/run, the Terminal composer through /api/control/tab-inject,
 * and feedback through its own path — three routes that must not each grow
 * their own opinion about how an image becomes a prompt.
 *
 * Folding server-side rather than client-side is deliberate: a client that
 * forgets to enrich sends a prompt referring to a screenshot nobody looked at,
 * and that failure is silent. Here it cannot be skipped.
 */

/** Wire schema for the optional `attachments` field on a dispatch body. */
export const AttachmentsField = z.array(AttachmentBodySchema).max(MAX_ATTACHMENTS).optional();

export type RawAttachments = z.infer<typeof AttachmentsField>;

/**
 * Returns the prompt with image descriptions and text files folded in.
 *
 * Never throws: describeAttachedImages already degrades to a note when the
 * vision provider is down, and a dispatch that loses its screenshot analysis
 * is still a dispatch the user asked for. Failing the whole send because a
 * description could not be generated would be the worse trade.
 */
export async function foldAttachmentsIntoPrompt(
  prompt: string,
  raw: RawAttachments,
): Promise<string> {
  if (!raw || raw.length === 0) return prompt;
  const attachments = raw.map(normalizeAttachment);
  const images = attachments.filter((a): a is ImageAttachment => a.kind === "image");
  const imageNote = images.length ? await describeAttachedImages(images, prompt) : "";
  return `${prompt}${imageNote}${renderTextAttachments(attachments)}`;
}

/**
 * For a prompt typed into a terminal agent: images go to the agent AS IMAGES
 * (lib/agent-attachments) — each gets a placeholder line and travels in the
 * command for the runner to write to a file — while text files are inlined as
 * before. No vision model is involved, so a rate-limited free tier can no
 * longer turn a screenshot into "could not analyse".
 */
export function stageAttachmentsForAgent(
  prompt: string,
  raw: RawAttachments,
): { prompt: string; images: AgentImage[] } {
  if (!raw || raw.length === 0) return { prompt, images: [] };
  const attachments = raw.map(normalizeAttachment);
  const images: AgentImage[] = attachments
    .filter((a): a is ImageAttachment => a.kind === "image")
    .map((a) => ({
      id: crypto.randomUUID(),
      name: a.name,
      mimeType: a.mimeType,
      dataBase64: a.dataBase64,
    }));
  return {
    prompt: `${withImageTokens(prompt, images)}${renderTextAttachments(attachments)}`,
    images,
  };
}
