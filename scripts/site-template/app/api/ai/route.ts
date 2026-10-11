import { z } from "zod";
import { ask } from "@/lib/ai";
import { requireUser } from "@/lib/auth/require";
import { limits, tooMany } from "@/lib/limits";
import { loadOwnModel } from "@/lib/own-model";

/**
 * POST /api/ai — the one example of a model call: { prompt } in, { text } out.
 *
 * Signed-in only, so the shared free budget cannot be drained anonymously, and
 * rate-limited per person. A person with their own key is served by it. The
 * prompt and the reply are never logged or stored.
 */
export const dynamic = "force-dynamic";

const Body = z.object({ prompt: z.string() });

export async function POST(request: Request) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const limited = limits.ai.check(`ai:${user.id}`);
  if (!limited.allowed) return tooMany(limited);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const outcome = await ask(parsed.data.prompt, {
    env: process.env,
    ownModel: await loadOwnModel(user.id),
    signal: request.signal,
  });
  if (outcome.ok) return Response.json({ text: outcome.text, ownModel: outcome.ownModel });
  const status = outcome.error === "not_configured" || outcome.error === "busy" ? 503 : 400;
  return Response.json({ error: outcome.error }, { status });
}
