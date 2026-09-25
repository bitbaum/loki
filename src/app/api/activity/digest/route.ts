// POST /api/activity/digest
//
// On-demand LLM-generated exec summary for the activity in a given window.
// Thin wrapper around lib/digest-generator. Only a person clicking reaches it;
// the digest email is built without a model (see crons/send-digest-emails).
//
// Cached for 10 minutes by (userId, window, projectKey) so re-opening the
// page within the cache window doesn't re-burn the LLM call.

import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { generateDigest } from "@/lib/digest-generator";
import { z, readJsonBody } from "@/lib/api/route-helpers";
import { MINUTE_MS } from "@/lib/constants/time";

const Body = z.object({
  window: z.string().optional(),
  project: z.string().nullable().optional(),
});

const WINDOW_LABELS: Record<string, string> = {
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
};

type CacheEntry = { generatedAt: number; markdown: string; model: string };
const CACHE_TTL_MS = 10 * MINUTE_MS;
const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, window: string, project: string | null) {
  return `${userId}|${window}|${project ?? "*"}`;
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = await readJsonBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const window = parsed.window ?? "day";
  const project = parsed.project ?? null;

  const key = cacheKey(userId, window, project);
  const force = req.nextUrl.searchParams.get("force") === "1";
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      markdown: cached.markdown,
      model: cached.model,
      generatedAt: new Date(cached.generatedAt).toISOString(),
      cached: true,
    });
  }

  try {
    const result = await generateDigest({
      userId,
      window,
      project,
      windowLabel: WINDOW_LABELS[window] ?? window,
    });
    const entry: CacheEntry = {
      generatedAt: Date.now(),
      markdown: result.markdown,
      model: result.model,
    };
    cache.set(key, entry);
    return NextResponse.json({
      markdown: result.markdown,
      model: result.model,
      generatedAt: result.generatedAt,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "groq call failed";
    const friendly = /groq 401/i.test(message)
      ? "Groq API key is invalid or revoked. Rotate it at https://console.groq.com/keys and update GROQ_API_KEY in .env.local."
      : `digest generation failed: ${message}`;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
