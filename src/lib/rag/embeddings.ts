/**
 * Provider-agnostic embeddings client (OpenAI /v1/embeddings shape).
 *
 * Ported from OrangeCat's services/ai/embeddings.ts so the two products share one
 * convention. Loki points it at a LOCAL fastembed server on the box
 * (BAAI/bge-small-en-v1.5, 384-dim) — no cloud key needed — but it's just an
 * env-switch away from text-embedding-3-small or any OpenAI-compatible endpoint.
 *
 *   EMBEDDINGS_BASE_URL  e.g. http://127.0.0.1:7997/v1   (unset → RAG disabled)
 *   EMBEDDINGS_MODEL     default BAAI/bge-small-en-v1.5
 *   EMBEDDINGS_DIM       default 384   (must match the DB vector(N) column)
 *   EMBEDDINGS_API_KEY   optional (local server needs none)
 *
 * Switching models = a migration: the vector(N) column dimension is fixed.
 */

const DEFAULT_MODEL = "BAAI/bge-small-en-v1.5";
export const EMBEDDINGS_DIM = Number(process.env.EMBEDDINGS_DIM ?? "384");

function baseUrl(): string | null {
  const u = process.env.EMBEDDINGS_BASE_URL?.trim();
  return u ? u.replace(/\/+$/, "") : null;
}

/** RAG is on only when an embeddings endpoint is configured (graceful-off locally). */
export function embeddingsEnabled(): boolean {
  return baseUrl() !== null;
}

function model(): string {
  return process.env.EMBEDDINGS_MODEL?.trim() || DEFAULT_MODEL;
}

// One request per this many inputs. A single request with the whole index
// (hundreds of chunks after section-chunking) overran the local server and
// timed out ("fetch failed"), so we page the embeds. A failed page nulls only
// its own inputs — the rest still embed.
//
// 16 matches the server's own batch (EMBED_BATCH_SIZE in scripts/embed-server.py).
// The server runs one request at a time, so a page is also how long a live
// caller can wait behind the nightly reindex. At 48 a page on a busy box could
// pass the 30s timeout below, and the 2026-11-07 reindex failed that way.
export const EMBED_BATCH = 16;

async function embedBatch(url: string, inputs: string[]): Promise<(number[] | null)[]> {
  try {
    const res = await fetch(`${url}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.EMBEDDINGS_API_KEY
          ? { Authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ model: model(), input: inputs }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error("[embeddings] HTTP", res.status, (await res.text()).slice(0, 200));
      return inputs.map(() => null);
    }
    const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
    const out: (number[] | null)[] = inputs.map(() => null);
    for (const d of json.data ?? []) out[d.index] = d.embedding;
    return out;
  } catch (e) {
    console.error("[embeddings] failed:", e instanceof Error ? e.message : e);
    return inputs.map(() => null);
  }
}

/** Embed a batch (paged). Returns null per-input on failure; [] when RAG is disabled. */
export async function embedTexts(inputs: string[]): Promise<(number[] | null)[]> {
  const url = baseUrl();
  if (!url || inputs.length === 0) return inputs.map(() => null);
  const out: (number[] | null)[] = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    out.push(...(await embedBatch(url, inputs.slice(i, i + EMBED_BATCH))));
  }
  return out;
}

export async function embedText(input: string): Promise<number[] | null> {
  return (await embedTexts([input]))[0];
}

/** pgvector text literal: [0.1,0.2,…] */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
