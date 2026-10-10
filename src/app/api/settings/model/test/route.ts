/**
 * POST { vendor } → one real, tiny turn on the user's own key for that
 * vendor: "did it actually answer, and how fast?"
 *
 * The probe (../probe) proves the vendor KNOWS the key by listing models. It
 * does not prove a chat completion works — a model id that is listed but not
 * enabled for the account, a vendor whose chat endpoint is down, a key with
 * credits for one product and not another all pass the probe and fail the
 * first turn. The settings screen runs this right after a save and on a
 * "Test" button, so "model added" is a sentence backed by an answer, with its
 * time, rather than a hope.
 *
 * Counted to the person like any own-key call (own_model_usage); a few
 * tokens. Rate-limited: it is a paid call on their account.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BYOK_VENDOR_IDS, type ByokVendorId } from "@bitbaum/ai-kit/byok";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOwnModelKey } from "@/db/queries/user-model-keys";
import { ownModelFrom, ownModelSecrets } from "@/lib/own-model";
import { callModelWithTools } from "@/lib/agent/llm";

export const runtime = "nodejs";

const Body = z.object({ vendor: z.enum(BYOK_VENDOR_IDS as [ByokVendorId, ...ByokVendorId[]]) });

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (!checkRateLimit(`own-model-test:${userId}`, 12, 10 * 60_000)) {
    return jsonError("Too many tests — wait a few minutes and try again.", 429);
  }
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;

  const config = await getOwnModelKey(userId, body.vendor);
  if (!config) return jsonError("No key stored for this provider.", 404);
  const own = { ...ownModelFrom([config]), userId };

  const startedAt = Date.now();
  try {
    const turn = await callModelWithTools({
      messages: [
        { role: "system", content: "Answer in one short, friendly sentence." },
        { role: "user", content: "Say hello and name yourself in at most eight words." },
      ],
      tools: [],
      validToolNames: [],
      feature: "own-model-test",
      own,
      maxTokens: 60,
    });
    return jsonOk({
      ok: true,
      ms: Date.now() - startedAt,
      model: turn.model,
      answer: turn.text.trim().slice(0, 160),
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const said = ownModelSecrets(own)
      .reduce((text, key) => text.split(key).join(`…${key.slice(-4)}`), raw)
      .replace(/^no chat model answered:\s*/, "")
      .slice(0, 240);
    return jsonOk({ ok: false, ms: Date.now() - startedAt, message: said });
  }
}
