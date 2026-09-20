import { db } from "@/db";
import { beaconSettings, userProjects } from "@/db/schema";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { DEFAULT_BEACON_COUNTDOWN_S, DEFAULT_AUTO_INJECT_MODE } from "@/lib/constants/control";
import { AUTO_INJECT_MODE_VALUES, type AutoInjectMode } from "@/config/beacon";

export type { AutoInjectMode } from "@/config/beacon";

/**
 * `popup_mode` and `min_idle_seconds` are both gone. Each described the popup
 * retired on 2026-06-11; their columns are dropped in the migration beside
 * this change. Keeping them was how a dead control stayed on the Settings
 * page for three months, saving a value nothing read.
 */
export type BeaconSettingsData = {
  countdown_seconds: number;
  whisper_model: string;
  transcription_provider: string;
  auto_inject_mode: AutoInjectMode;
};

const DEFAULTS: BeaconSettingsData = {
  countdown_seconds: DEFAULT_BEACON_COUNTDOWN_S,
  whisper_model: "base",
  transcription_provider: "auto",
  // Autopilot — see DEFAULT_AUTO_INJECT_MODE in src/lib/constants/control.ts for
  // the rationale. Safety rails live in /api/control/dispatch + the Stop hook.
  auto_inject_mode: DEFAULT_AUTO_INJECT_MODE,
};

function coerceAutoInjectMode(v: string | null | undefined): AutoInjectMode {
  return AUTO_INJECT_MODE_VALUES.includes(v as AutoInjectMode)
    ? (v as AutoInjectMode)
    : DEFAULT_AUTO_INJECT_MODE;
}

export async function getBeaconSettings(userId: string): Promise<BeaconSettingsData> {
  const rows = await db
    .select()
    .from(beaconSettings)
    .where(eq(beaconSettings.userId, userId))
    .limit(1);

  if (!rows[0]) return { ...DEFAULTS };

  return {
    countdown_seconds: rows[0].countdownSeconds,
    whisper_model: rows[0].whisperModel,
    transcription_provider: rows[0].transcriptionProvider,
    auto_inject_mode: coerceAutoInjectMode(rows[0].autoInjectMode),
  };
}

/**
 * SSOT for "which users have fleet autopilot on" — for schedulers (crons) that
 * fan out across users. A user counts as ON when auto_inject_mode != 'off',
 * INCLUDING users with no beacon row at all: a missing row means
 * DEFAULT_AUTO_INJECT_MODE ('on'), exactly like getBeaconSettings above.
 * The nudge-idle cron previously raw-queried only EXISTING rows, so
 * default-mode users were invisible to the scheduler and the fleet silently
 * never nudged while the Control hero said "Autopilot on" (2026-07-02
 * dead-fleet incident — one state, two interpretations).
 * Scoped to users with active projects so the scheduler skips spectator accounts.
 */
export async function getFleetAutopilotUserIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: userProjects.userId })
    .from(userProjects)
    .leftJoin(beaconSettings, eq(beaconSettings.userId, userProjects.userId))
    .where(
      and(
        eq(userProjects.isActive, true),
        or(isNull(beaconSettings.autoInjectMode), ne(beaconSettings.autoInjectMode, "off")),
      ),
    );
  return rows.map((r) => r.userId);
}

export async function upsertBeaconSettings(
  userId: string,
  patch: Partial<BeaconSettingsData>,
): Promise<BeaconSettingsData> {
  const inserted: BeaconSettingsData = { ...DEFAULTS, ...patch };
  const updateSet: Partial<typeof beaconSettings.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (patch.countdown_seconds !== undefined) updateSet.countdownSeconds = patch.countdown_seconds;
  if (patch.whisper_model !== undefined) updateSet.whisperModel = patch.whisper_model;
  if (patch.transcription_provider !== undefined)
    updateSet.transcriptionProvider = patch.transcription_provider;
  if (patch.auto_inject_mode !== undefined) updateSet.autoInjectMode = patch.auto_inject_mode;

  await db
    .insert(beaconSettings)
    .values({
      userId,
      countdownSeconds: inserted.countdown_seconds,
      whisperModel: inserted.whisper_model,
      transcriptionProvider: inserted.transcription_provider,
      autoInjectMode: inserted.auto_inject_mode,
    })
    .onConflictDoUpdate({
      target: beaconSettings.userId,
      set: updateSet,
    });

  return getBeaconSettings(userId);
}
