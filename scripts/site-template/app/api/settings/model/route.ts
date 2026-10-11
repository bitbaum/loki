import { BYOK_VENDOR_IDS } from "@bitbaum/ai-kit/byok";
import { probeByokKey } from "@bitbaum/ai-kit/byok-probe";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require";
import { readOwnModel, removeOwnModel, saveOwnModel } from "@/lib/own-model";
import { limits, tooMany } from "@/lib/limits";
import { canSeal } from "@/lib/secrets";

/**
 * A person's own model: GET what is saved (never the key — vendor, model and
 * a hint), PUT a new key, DELETE it. The save CHECKS AGAIN with the vendor and
 * refuses a model the key cannot use: the browser's "it worked" is never
 * trusted (fleet SHARED.md, "Your own model", rule 1).
 */
export const dynamic = "force-dynamic";

const Put = z.object({
  vendor: z.enum(BYOK_VENDOR_IDS as unknown as [string, ...string[]]),
  apiKey: z.string().trim().min(8).max(400),
  model: z.string().trim().min(1).max(200),
});

export async function GET(request: Request) {
  const { user, response } = await requireUser(request);
  if (response) return response;
  return Response.json({ saved: await readOwnModel(user.id), canSave: canSeal() });
}

export async function PUT(request: Request) {
  const { user, response } = await requireUser(request);
  if (response) return response;
  if (!canSeal()) return Response.json({ error: "sealing_unavailable" }, { status: 503 });

  const limited = limits.modelProbe.check(`model-save:${user.id}`);
  if (!limited.allowed) return tooMany(limited);

  const parsed = Put.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const probe = await probeByokKey(parsed.data.vendor, parsed.data.apiKey);
  if (!probe.ok)
    return Response.json({ error: "key_refused", message: probe.message }, { status: 422 });
  if (probe.models.length > 0 && !probe.models.includes(parsed.data.model)) {
    return Response.json({ error: "model_not_available" }, { status: 422 });
  }

  const saved = await saveOwnModel(user.id, {
    vendor: parsed.data.vendor as never,
    apiKey: parsed.data.apiKey,
    model: parsed.data.model,
  });
  return Response.json({ saved });
}

export async function DELETE(request: Request) {
  const { user, response } = await requireUser(request);
  if (response) return response;
  await removeOwnModel(user.id);
  return Response.json({ saved: null });
}
