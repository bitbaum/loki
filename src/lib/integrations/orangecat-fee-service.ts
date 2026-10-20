/**
 * List a fee as a service in the BUILDER's own name on OrangeCat.
 *
 * The crew mirror (orangecat-human-task.ts) lists with the studio's
 * integration key, so OrangeCat owns that listing under the studio's actor
 * and paying it pays the studio. This one presents the builder's own
 * "Login with OrangeCat" token (orangecat-identity.ts), so the service is
 * the builder's, the client pays it at the builder's page, and settlement
 * lands in the builder's wallet. Loki holds no money and no key of theirs.
 *
 * Needs the `service.write` scope on the builder's token (src/auth.ts asks
 * for it at sign-in); a link minted before that scope existed answers 403
 * and the builder signs in to Loki again to re-mint — `relink` says so.
 */

import { getOrangeCatLink } from "@/lib/integrations/orangecat-identity";
import { OC_BASE } from "@/lib/integrations/orangecat";
import { orangeCatServiceUrl } from "@/lib/integrations/orangecat-human-task";
import type { feeServicePayload } from "@/lib/studio/fee";

export type FeeListing =
  | { ok: true; serviceId: string; url: string }
  | { ok: false; reason: "not_linked" | "relink" | "oc_error" };

export async function listFeeService(
  builderUserId: string,
  payload: ReturnType<typeof feeServicePayload>,
  idempotencyKey: string,
): Promise<FeeListing> {
  const link = await getOrangeCatLink(builderUserId);
  if (!link) return { ok: false, reason: "not_linked" };
  try {
    const res = await fetch(`${OC_BASE}/api/v1/services`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${link.accessToken}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 403) return { ok: false, reason: "relink" };
    if (!res.ok) {
      console.warn("[orangecat-fee] service listing failed", {
        status: res.status,
        body: (await res.text()).slice(0, 300),
      });
      return { ok: false, reason: "oc_error" };
    }
    const json = (await res.json()) as { data?: { id?: string } };
    const serviceId = json.data?.id;
    if (!serviceId) return { ok: false, reason: "oc_error" };
    return { ok: true, serviceId, url: orangeCatServiceUrl(serviceId) };
  } catch (err) {
    console.warn("[orangecat-fee] service listing failed", {
      reason: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, reason: "oc_error" };
  }
}
