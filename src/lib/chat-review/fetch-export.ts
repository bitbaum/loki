import type { ChatTranscript } from "@bitbaum/chatkit";
import { REVIEW_EXPORT_LIMIT, type ChatReviewProduct } from "@/config/chat-review";
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";

/** What every product's review-export answers (docs/architecture/chat-review.md). */
export type ChatReviewExport = {
  product: string;
  /** What that assistant can do — its tools, data and limits, in its own words. */
  scope: string;
  transcripts: ChatTranscript[];
};

export type FetchExportResult =
  { ok: true; export: ChatReviewExport } | { ok: false; error: string };

/**
 * One product's conversations since `since`, through its review-export with
 * the shared token. A refusal is a result, not a throw: the night continues
 * with the other products and the log says which one did not answer and why.
 */
export async function fetchExport(
  product: ChatReviewProduct,
  since: Date,
  options: { token: string; fetchImpl?: typeof fetch; limit?: number } = { token: "" },
): Promise<FetchExportResult> {
  if (!options.token) return { ok: false, error: "CHAT_REVIEW_TOKEN is not set" };
  const url = new URL(product.exportUrl);
  url.searchParams.set("since", since.toISOString());
  url.searchParams.set("limit", String(Math.min(options.limit ?? REVIEW_EXPORT_LIMIT, 50)));
  const doFetch = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_LONG_MS),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const body = (await res.json().catch(() => null)) as Partial<ChatReviewExport> | null;
  if (!body || typeof body.scope !== "string" || !Array.isArray(body.transcripts)) {
    return { ok: false, error: "not a review export" };
  }
  return {
    ok: true,
    export: {
      product: typeof body.product === "string" ? body.product : product.key,
      scope: body.scope,
      transcripts: body.transcripts.filter(
        (t): t is ChatTranscript =>
          !!t && typeof t === "object" && typeof t.id === "string" && Array.isArray(t.turns),
      ),
    },
  };
}
