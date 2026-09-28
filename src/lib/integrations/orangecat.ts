/**
 * OrangeCat integration — outbound calls FROM Loki TO OrangeCat.
 *
 * Loop A (subscriptions): every time a Loki user adds a subscription
 * on the /money page, we mirror it into OrangeCat as a `service` record
 * owned by the actor the integration key is bound to (the Loki
 * group actor inside OrangeCat). This gives:
 *   - one ledger across the studio (Mao sees Loki's spend in OC)
 *   - the bitbaum studio narrative its first real data point
 *
 * Auth: `ORANGECAT_API_KEY` (mint at /settings/integrations on OrangeCat,
 * choose the Loki group actor at mint time). The SDK takes care of
 * Idempotency-Key, retries (3, exp backoff honouring Retry-After),
 * timeouts (20s), and the standard error envelope.
 *
 * The sync is FIRE-AND-FORGET — a network blip on OrangeCat must not
 * fail the subscription POST. Failures are logged with enough context
 * to backfill later; user-facing flow is unaffected.
 *
 * Created: 2026-06-03
 */

import { eq } from "drizzle-orm";
import type { OrangeCatClient, OrangeCatError } from "@orangecat/sdk";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { ORANGECAT_BASE_FALLBACK } from "@/config/orangecat";

/** SSOT for the OrangeCat origin Loki calls (env override, else fallback).
 *  Every FC→OC integration imports this instead of re-deriving it. */
export const OC_BASE = process.env.ORANGECAT_API_BASE ?? ORANGECAT_BASE_FALLBACK;

interface SubscriptionForSync {
  id: string;
  name: string;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
  frequency: string | null;
  notes: string | null;
}

let cached: OrangeCatClient | null = null;
let errorClass: typeof OrangeCatError | null = null;

/**
 * Returns the singleton client when configured, or `null` when the env
 * vars are missing. Callers must handle null — most users / dev
 * environments will not have the integration set up, and the absence is
 * not an error.
 *
 * The SDK is loaded lazily via dynamic import: @orangecat/sdk is ESM-only
 * (its `exports` map has no `require` condition), and a static import here
 * breaks the box-runner — its tsx/CJS require of the chain box-workspace →
 * user-projects → orangecat-publish → this module threw
 * ERR_PACKAGE_PATH_NOT_EXPORTED at import time, which silently killed
 * workspace prep for EVERY cloud dispatch (agent PTYs died in a
 * nonexistent laptop path, runs stuck "waiting"; found 2026-07-17).
 */
export async function getOrangeCatClient(): Promise<OrangeCatClient | null> {
  if (cached) {
    return cached;
  }
  const apiKey = process.env.ORANGECAT_API_KEY;
  if (!apiKey || !apiKey.startsWith("ock_")) {
    return null;
  }
  const sdk = await import("@orangecat/sdk");
  errorClass = sdk.OrangeCatError;
  cached = new sdk.OrangeCatClient({
    apiKey,
    baseUrl: OC_BASE,
    userAgent: `loki/${process.env.npm_package_version ?? "0.1.0"} (+sdk)`,
  });
  return cached;
}

/**
 * Mirror a Loki subscription into OrangeCat as a `service` record.
 * Fire-and-forget — never throws. Returns the OrangeCat service id on
 * success so callers can persist the link later (schema migration is a
 * follow-up; for the spike we log it).
 */
export async function syncSubscriptionToOrangeCat(
  sub: SubscriptionForSync,
): Promise<string | null> {
  const client = await getOrangeCatClient();
  if (!client) {
    return null;
  }
  try {
    const service = await client.services.create(
      {
        title: sub.vendor ? `${sub.name} — ${sub.vendor}` : sub.name,
        description: buildDescription(sub),
        category: "subscription",
        fixed_price: sub.amount ?? undefined,
        currency: sub.currency ?? undefined,
      },
      {
        // Stable idempotency key so retried POSTs on the Loki side
        // dedupe at OrangeCat (when server-side dedup lands).
        idempotencyKey: `loki_sub_${sub.id}`,
      },
    );
    // Persist the back-link so /money can render a "Synced ✓" badge and
    // future backfills know which rows have already been mirrored. Errors
    // here are non-fatal — the OrangeCat side has the truth either way.
    try {
      await db
        .update(subscriptions)
        .set({ orangecatServiceId: service.id })
        .where(eq(subscriptions.id, sub.id));
    } catch (linkErr) {
      console.warn("[orangecat] back-link write failed (non-fatal)", {
        loki_subscription_id: sub.id,
        orangecat_service_id: service.id,
        linkErr,
      });
    }
    console.log("[orangecat] subscription synced", {
      loki_subscription_id: sub.id,
      orangecat_service_id: service.id,
    });
    return service.id;
  } catch (err) {
    logSyncFailure(sub, err);
    return null;
  }
}

function buildDescription(sub: SubscriptionForSync): string {
  const freq = sub.frequency ? sub.frequency.toLowerCase() : "recurring";
  const lines = [`Loki subscription · ${freq}`, sub.notes ? `Note: ${sub.notes}` : null].filter(
    Boolean,
  );
  return lines.join("\n");
}

function logSyncFailure(sub: SubscriptionForSync, err: unknown): void {
  if (errorClass && err instanceof errorClass) {
    console.warn("[orangecat] sync failed (non-fatal)", {
      loki_subscription_id: sub.id,
      code: err.code,
      status: err.status,
      message: err.message,
      retryAfter: err.retryAfter,
    });
    return;
  }
  console.warn("[orangecat] sync failed (non-fatal, unknown error)", {
    loki_subscription_id: sub.id,
    err,
  });
}
