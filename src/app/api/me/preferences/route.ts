import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getUserPreferences, upsertUserPreferences } from "@/db/queries/user-preferences";
import {
  STANDING_APPROVAL_ELIGIBLE,
  sanitizeStandingApprovals,
} from "@/lib/actions/standing-approval";
import { PROVIDER_IDS, serializeProviderOrder } from "@/lib/provider-switch";

const SUPPORTED_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

const SUPPORTED_LOCALES = [
  "en-US",
  "en-GB",
  "en-AU",
  "en-CA",
  "de-CH",
  "de-DE",
  "de-AT",
  "fr-FR",
  "fr-CH",
  "fr-BE",
  "es-ES",
  "es-MX",
  "it-IT",
  "it-CH",
  "pt-BR",
  "pt-PT",
  "ja-JP",
  "zh-CN",
  "zh-TW",
  "ko-KR",
  "nl-NL",
  "pl-PL",
  "sv-SE",
] as const;

const PatchBody = z.object({
  homeCity: z.string().trim().max(100).nullable().optional(),
  homeTimezone: z
    .string()
    .refine((s) => SUPPORTED_TIMEZONES.has(s), "Invalid timezone")
    .nullable()
    .optional(),
  homeLocale: z
    .string()
    .refine((s) => (SUPPORTED_LOCALES as readonly string[]).includes(s), "Unsupported locale")
    .nullable()
    .optional(),
  currentCity: z.string().trim().max(100).nullable().optional(),
  currentTimezone: z
    .string()
    .refine((s) => SUPPORTED_TIMEZONES.has(s), "Invalid timezone")
    .nullable()
    .optional(),
  currentCityUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .nullable()
    .optional(),
  writingVoice: z.string().trim().max(600).nullable().optional(),
  memoryEnabled: z.boolean().optional(),
  // Accepted as a LIST and stored as one string, so the client never has to
  // know the storage shape and an unknown id can never reach the column.
  agentOrder: z
    .array(z.string())
    .max(PROVIDER_IDS.length)
    .transform(serializeProviderOrder)
    .nullable()
    .optional(),
  // Which action types Loki may carry out without a per-item tap.
  //
  // Narrowed HERE as well as in the query layer, and against the same
  // hard-coded set. This is the one field on this route that grants authority
  // rather than storing a preference, so it does not get to rely on a single
  // check somewhere downstream — an unknown or ineligible type is dropped,
  // silently and always, rather than rejected: the request is honoured for the
  // parts that are real, and nothing it asked for beyond them takes effect.
  standingApprovals: z
    .array(z.string())
    .max(STANDING_APPROVAL_ELIGIBLE.length)
    .transform(sanitizeStandingApprovals)
    .optional(),
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getUserPreferences(userId));
}

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, PatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const updated = await upsertUserPreferences(userId, dataOrResp);
  return NextResponse.json(updated);
}

export { SUPPORTED_LOCALES };
