import { BYOK_VENDOR_IDS } from "@bitbaum/ai-kit/byok";
import { probeByokKey } from "@bitbaum/ai-kit/byok-probe";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require";
import { limits, tooMany } from "@/lib/limits";

/**
 * POST /api/settings/model/probe — check a key with its vendor before saving
 * it: { ok, status, message, models, suggested }. The message is the vendor's
 * own words with the key redacted; `status: null` means "could not check",
 * never "wrong key". Nothing is stored and the key is not echoed back.
 */
export const dynamic = "force-dynamic";

const Body = z.object({
  vendor: z.enum(BYOK_VENDOR_IDS as unknown as [string, ...string[]]),
  apiKey: z.string().trim().min(8).max(400),
});

export async function POST(request: Request) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const limited = limits.modelProbe.check(`model-probe:${user.id}`);
  if (!limited.allowed) return tooMany(limited);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const probe = await probeByokKey(parsed.data.vendor, parsed.data.apiKey);
  return Response.json({
    ok: probe.ok,
    status: probe.status,
    message: probe.message,
    models: probe.models,
    suggested: probe.suggested,
  });
}
