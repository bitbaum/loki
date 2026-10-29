import { slidingWindow, toHeaders, type LimitResult } from "limitkit";
/** App-only budgets; account limits and proxy/recipient keys belong to accountkit. */
export const limits = {
  ai: slidingWindow({ limit: 20, windowMs: 60 * 60_000 }),
  modelProbe: slidingWindow({ limit: 20, windowMs: 10 * 60_000 }),
};
export function tooMany(result: LimitResult): Response {
  return Response.json(
    { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { ...toHeaders(result), "Cache-Control": "no-store" } },
  );
}
