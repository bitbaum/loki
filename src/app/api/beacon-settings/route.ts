import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { MIN_BEACON_COUNTDOWN_S, MAX_BEACON_COUNTDOWN_S } from "@/lib/constants/control";
import {
  WHISPER_MODEL_VALUES,
  TRANSCRIPTION_PROVIDER_VALUES,
  AUTO_INJECT_MODE_VALUES,
} from "@/config/beacon";
import { getApiUserId } from "@/lib/session";
import { getBeaconSettings, upsertBeaconSettings } from "@/db/queries/beacon-settings";
import { getProjectAutopilotOverride } from "@/db/queries/projects";
import { DEFAULT_AUTO_INJECT_MODE } from "@/lib/constants/control";
import type { AutoInjectMode } from "@/config/beacon";

export type { BeaconSettingsData } from "@/db/queries/beacon-settings";

const PatchBody = z.object({
  countdown_seconds: z
    .number()
    .int()
    .min(MIN_BEACON_COUNTDOWN_S)
    .max(MAX_BEACON_COUNTDOWN_S)
    .optional(),
  whisper_model: z.enum(WHISPER_MODEL_VALUES).optional(),
  transcription_provider: z.enum(TRANSCRIPTION_PROVIDER_VALUES).optional(),
  auto_inject_mode: z.enum(AUTO_INJECT_MODE_VALUES).optional(),
});

export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getBeaconSettings(userId);
  const project = req.nextUrl.searchParams.get("project")?.trim();
  if (!project) return NextResponse.json(settings);

  const userMode = (settings?.auto_inject_mode ?? DEFAULT_AUTO_INJECT_MODE) as AutoInjectMode;
  const override = await getProjectAutopilotOverride(userId, project).catch(() => null);
  const effectiveMode = override ?? userMode;
  return NextResponse.json({
    ...settings,
    project,
    project_override: override,
    effective_mode: effectiveMode,
  });
}

export async function PATCH(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, PatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const updated = await upsertBeaconSettings(userId, dataOrResp);
  return NextResponse.json(updated);
}
