/**
 * Read an OpenAI-compatible `stream: true` response body, one chunk at a time.
 *
 * Every vendor in the chain speaks this shape — that is the premise the whole
 * chain rests on — so the FRAMING is identical everywhere and only the fields
 * each caller cares about differ. This is that framing, once: the tool loop
 * (`agent/llm.ts`) needs `delta.tool_calls` as well as content; the single-shot
 * fallback (`lib/groq.ts`) needs only content. Two readers would be two places
 * for a partial-frame bug to live, and a stream that drops frames does not
 * fail — it silently truncates an answer.
 */

/** The subset of a chunk both callers read. Extra fields survive the cast. */
export type SseDelta = {
  choices?: Array<{
    /**
     * Why the model stopped, on the LAST chunk of a choice.
     *
     * The one field that separates a finished answer from a severed one, and
     * it rides the same frames this reader was already parsing for `usage`.
     * The header above says a dropped stream "does not fail — it silently
     * truncates an answer"; this is the vendor telling us it happened.
     */
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { total_tokens?: number } | null;
};

/**
 * Call `onChunk` for every well-formed frame in `body`, then return.
 *
 * A frame that fails to parse is skipped rather than thrown: a malformed
 * keepalive is not worth losing an answer over. A frame cut across a network
 * chunk boundary is held until the rest of it arrives — which is the whole
 * reason this is not a `split("\n")` one-liner.
 */
export async function readSseChunks(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: SseDelta) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Whatever follows the last newline may be half a frame.
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          onChunk(JSON.parse(payload) as SseDelta);
        } catch {
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
