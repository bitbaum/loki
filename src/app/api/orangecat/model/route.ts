/**
 * POST /api/orangecat/model — a person's OrangeCat bots, answered on a key the
 * person keeps in Loki.
 *
 * The signed OrangeCat rail, for the Loki account linked to the actor, like
 * the other doors under this prefix. Four things, one door
 * (lib/orangecat-model.ts):
 *
 *   keys      which keys the person has here and which are switched on for
 *             OrangeCat. Vendor, chosen model and the "…abcd" hint only.
 *   share     switch one key on or off. OrangeCat calls this when the person,
 *             signed in there, taps "use the key I saved in Loki"; the same
 *             switch is in Settings → Your model here.
 *   models    the models a switched-on key can use, from the vendor.
 *   complete  one chat completion with a switched-on key, with the functions
 *             the model may ask for. Loki runs none of them.
 *
 * The key is opened here, sent to the vendor's own host, and never returned
 * or logged. A key that is not switched on answers 403 whatever is asked.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { vendorById } from "@/config/model-vendors";
import { logDebug } from "@/db/queries/debug-logs";
import { getOrangecatModelKey, listOwnModels, setForOrangecat } from "@/db/queries/user-model-keys";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { isFreshIssuedAt } from "@/lib/integrations/orangecat-actor-status";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { readModels } from "@/lib/models/probe";
import {
  ORANGECAT_MODEL_CALLS_PER_HOUR,
  ORANGECAT_MODEL_MAX_BODY_CHARS,
  OrangecatModelRequest,
  completeAtVendor,
  shareableVendor,
} from "@/lib/orangecat-model";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z
  .object({
    actorId: z.string().uuid(),
    issuedAt: z.string().datetime(),
    request: OrangecatModelRequest,
  })
  .strict();

const NOT_SHARED = {
  error: "key not shared",
  detail:
    "That key is not switched on for OrangeCat. Switch it on in Loki under Settings → Your model, or on OrangeCat under Settings → AI.",
};

export async function POST(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > ORANGECAT_MODEL_MAX_BODY_CHARS) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "model rail not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, issuedAt, request } = dataOrResp;

  // Signed, but with no nonce: without this a captured request replays forever.
  if (!isFreshIssuedAt(issuedAt)) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  try {
    const user = await getUserByOrangeCatActorId(actorId);
    if (!user) {
      return NextResponse.json(
        {
          error: "no linked Loki account",
          detail:
            "This OrangeCat identity is not linked to a Loki account yet. Sign in to Loki with the same OrangeCat identity once, then try again.",
        },
        { status: 409 },
      );
    }
    const noStore = { headers: { "Cache-Control": "no-store" } };

    if (request.do === "keys") {
      const keys = (await listOwnModels(user.id))
        .filter((k) => shareableVendor(k.vendor))
        .map((k) => ({
          vendor: k.vendor,
          label: vendorById(k.vendor)?.label ?? k.vendor,
          model: k.model,
          keyHint: k.keyHint,
          shared: k.forOrangecat,
        }));
      return NextResponse.json({ ok: true, keys }, noStore);
    }

    if (request.do === "share") {
      const changed = await setForOrangecat(user.id, request.vendor, request.on);
      if (!changed) {
        return NextResponse.json(
          { error: "no such key", detail: "There is no key for that provider in Loki to share." },
          { status: 404 },
        );
      }
      await logDebug({
        source: "orangecat/model",
        level: "info",
        message: request.on
          ? "a key was switched on for OrangeCat bots, from OrangeCat"
          : "a key was switched off for OrangeCat bots, from OrangeCat",
        meta: { actorId, userId: user.id, vendor: request.vendor },
      }).catch(() => {});
      return NextResponse.json(
        { ok: true, vendor: changed.vendor, shared: changed.forOrangecat },
        noStore,
      );
    }

    const vendor = shareableVendor(request.vendor);
    const key = vendor ? await getOrangecatModelKey(user.id, request.vendor) : null;
    if (!vendor || !key) return NextResponse.json(NOT_SHARED, { status: 403 });

    if (request.do === "models") {
      const read = await readModels(`${vendor.baseUrl}/models`, key.apiKey, fetch);
      const models = read.records.map((r) => r.id).slice(0, 200);
      return NextResponse.json({ ok: true, vendor: vendor.id, chosen: key.model, models }, noStore);
    }

    // One ceiling per account, across all its bots.
    if (!checkRateLimit(`orangecat-model:${user.id}`, ORANGECAT_MODEL_CALLS_PER_HOUR, 3_600_000)) {
      return NextResponse.json(
        {
          error: "too many calls",
          detail: `Your bots made ${ORANGECAT_MODEL_CALLS_PER_HOUR} model calls through Loki this hour, which is the ceiling. They answer again within the hour.`,
        },
        { status: 429 },
      );
    }
    const done = await completeAtVendor({
      baseUrl: vendor.baseUrl,
      apiKey: key.apiKey,
      model: request.model ?? key.model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      tools: request.tools,
      toolChoice: request.toolChoice,
    });
    if (!done.ok) {
      // The vendor's own refusal, passed on as a fact about the vendor: the
      // rail itself worked, so the envelope is a 200 and `done` is false.
      return NextResponse.json(
        { ok: true, done: false, vendor: vendor.id, status: done.status, detail: done.detail },
        noStore,
      );
    }
    return NextResponse.json(
      {
        ok: true,
        done: true,
        vendor: vendor.id,
        model: done.model,
        content: done.content,
        toolCalls: done.toolCalls,
        finishReason: done.finishReason,
        usage: done.usage,
      },
      noStore,
    );
  } catch (err) {
    console.error("[orangecat/model] failed:", (err as Error).message);
    return NextResponse.json({ error: "model rail failed" }, { status: 500 });
  }
}
