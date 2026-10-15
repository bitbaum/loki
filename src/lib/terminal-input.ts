/** Keep each JSON input below the route's 4000-character cap without cutting a Unicode pair. */
const CHUNK_CHARS = 1500;
export function* terminalInputChunks(text: string): Generator<string> {
  let chunk = "";
  for (const point of text) {
    if (chunk.length + point.length > CHUNK_CHARS) {
      yield chunk;
      chunk = "";
    }
    chunk += point;
  }
  if (chunk) yield chunk;
}
