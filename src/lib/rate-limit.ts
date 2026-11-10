import type { NextRequest } from "next/server";
import { slidingWindow, clientIp, MemoryStore, type Limiter } from "@bitbaum/limitkit";

/**
 * Rate limiting — now owned by `limitkit` (see dotfiles/SHARED.md).
 *
 * This file keeps the call signatures its eight callers were written against,
 * so adopting the package changed no route. What DID change, silently for the
 * better: the old implementation kept a bare Map keyed by client IP with no
 * eviction — every stranger who ever hit an endpoint left an entry until the
 * process restarted. limitkit's MemoryStore is bounded (LRU past 5 000 keys),
 * so that slow leak is impossible by construction.
 *
 * Keep this a shim. A local re-implementation "just for one tweak" is how the
 * shared version becomes the stale version — the fix that lands upstream then
 * silently never reaches here.
 */

const store = new MemoryStore();

/** One limiter per distinct rule; rules are few (per-route constants). */
const limiters = new Map<string, Limiter>();

/**
 * Returns true if the request is allowed, false if the bucket is full (→ 429).
 *
 * @param key      Unique bucket key, e.g. `"register:1.2.3.4"`
 * @param limit    Max hits allowed within the window
 * @param windowMs Rolling window length in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const ruleKey = `${limit}/${windowMs}`;
  let limiter = limiters.get(ruleKey);
  if (!limiter) {
    limiter = slidingWindow({ limit, windowMs }, store);
    limiters.set(ruleKey, limiter);
  }
  // Keys are already namespaced by the caller ("register:<ip>"), and the rule
  // is part of the limiter, so two routes sharing a rule still count apart.
  return limiter.check(key).allowed;
}

/** Extract the real client IP from Next.js request headers. */
export function getClientIp(req: NextRequest): string {
  return clientIp(req.headers);
}
