import type { Attachment } from "@/lib/loki/attachments";

/**
 * The pictures a chat message carries, as the transcript shows them.
 *
 * A sent image is stored once (conversation_images) and the message keeps
 * only its path, so a thread loads light and the picture still shows after a
 * reload, on the phone, a week later. Client-safe and pure.
 */
export type MessageImage = { src: string; caption: string };

export function conversationImagePath(conversationId: string, imageId: string): string {
  return `/api/conversations/${conversationId}/images/${imageId}`;
}

const STORED = /^\/api\/conversations\/[0-9a-f-]{36}\/images\/[0-9a-f-]{36}$/i;
const LOCAL = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

/** Read a message's pictures. Only our own stored paths, or — for the bubble
 *  shown while a message is still sending — the sender's own picked images. */
export function readMessageImages(meta: unknown): MessageImage[] {
  const raw = (meta as { images?: unknown } | null)?.images;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (i): i is MessageImage =>
        !!i &&
        typeof (i as MessageImage).src === "string" &&
        (STORED.test((i as MessageImage).src) || LOCAL.test((i as MessageImage).src)),
    )
    .map((i) => ({ src: i.src, caption: typeof i.caption === "string" ? i.caption : "Image" }))
    .slice(0, 5);
}

/** The bubble shown the instant Send is tapped, before the server answers. */
export function localMessageImages(attachments: readonly Attachment[]): MessageImage[] {
  return attachments
    .filter((a) => a.kind === "image")
    .map((a) => ({
      src: `data:${a.mimeType};base64,${a.dataBase64}`,
      caption: a.name,
    }));
}
