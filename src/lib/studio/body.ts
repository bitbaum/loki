import { STUDIO } from "@/config/studio";
export class StudioBodyTooLarge extends Error {}
/** Enforce the limit even when the client streams a body without Content-Length. */
export async function readStudioBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > STUDIO.maxBody)
    throw new StudioBodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > STUDIO.maxBody) {
        await reader.cancel();
        throw new StudioBodyTooLarge();
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      return null;
    }
  } finally {
    reader.releaseLock();
  }
}
