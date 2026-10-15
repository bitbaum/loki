/**
 * Loki composer attachments — SSOT for limits, wire format, and prompt rendering.
 *
 * Text files fold inline into the agent prompt. Images are described server-side
 * via Groq vision (see vision.ts) because terminal agents cannot read raw pixels.
 */
import { z } from "zod";

/** Max files per message. */
export const MAX_ATTACHMENTS = 5;
/** Max characters per text file — inline in the prompt. */
export const MAX_ATTACHMENT_CHARS = 100_000;
/** Max raw image bytes before base64 (~4MB Groq vision cap after encoding). */
export const MAX_IMAGE_BYTES = 2_800_000;

const IMAGE_MIME = /^image\/(jpeg|jpg|png|gif|webp)$/i;

export type TextAttachment = { kind: "text"; name: string; content: string };
export type ImageAttachment = {
  kind: "image";
  name: string;
  mimeType: string;
  dataBase64: string;
};
export type Attachment = TextAttachment | ImageAttachment;

/** Client-only preview URL — never sent to the API. */
export type StagedAttachment = Attachment & { previewUrl?: string };

export const AttachmentBodySchema = z.union([
  z.object({
    kind: z.literal("text"),
    name: z.string().trim().min(1).max(200),
    content: z.string().max(MAX_ATTACHMENT_CHARS),
  }),
  z.object({
    kind: z.literal("image"),
    name: z.string().trim().min(1).max(200),
    mimeType: z.string().trim().regex(IMAGE_MIME, "Unsupported image type"),
    dataBase64: z.string().min(1).max(5_500_000),
  }),
  // Legacy wire shape (pre-kind) — treated as text.
  z.object({
    name: z.string().trim().min(1).max(200),
    content: z.string().max(MAX_ATTACHMENT_CHARS),
  }),
]);

export function normalizeAttachment(raw: z.infer<typeof AttachmentBodySchema>): Attachment {
  if ("kind" in raw && raw.kind === "image") {
    return { kind: "image", name: raw.name, mimeType: raw.mimeType, dataBase64: raw.dataBase64 };
  }
  const content = "content" in raw ? raw.content : "";
  return { kind: "text", name: raw.name, content };
}

/** `data:image/png;base64,AAAA` → `AAAA`. FileReader hands back a data URL;
 *  the wire format carries raw base64. Lives here rather than in a composer so
 *  every surface that stages an image encodes it identically. */
export function stripDataUrlBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export function isImageMime(mime: string): boolean {
  return IMAGE_MIME.test(mime);
}

/** Human-readable attachment list for the user bubble (filenames only). */
export function attachmentNoteLabel(attachments: Attachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  const names = attachments.map((a) => (a.kind === "image" ? `${a.name} (image)` : a.name));
  return `\n\n[Attached: ${names.join(", ")}]`;
}

/**
 * Render text attachments as a prompt suffix. Image descriptions are added
 * separately by describeAttachedImages() in vision.ts.
 */
export function renderTextAttachments(attachments: Attachment[] | undefined): string {
  const text = attachments?.filter((a): a is TextAttachment => a.kind === "text") ?? [];
  if (text.length === 0) return "";
  return text.map((a) => `\n\n--- Attached file: ${a.name} ---\n${a.content}`).join("");
}
