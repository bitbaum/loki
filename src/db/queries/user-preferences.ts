import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { WEATHER_CITY } from "@/lib/constants/today";

export type UserPreferencesData = {
  homeCity: string | null;
  homeTimezone: string | null;
  homeLocale: string | null;
  currentCity: string | null;
  currentTimezone: string | null;
  currentCityUntil: string | null;
  writingVoice: string | null;
  memoryEnabled: boolean;
  /** Preferred provider order, comma-separated agent ids. Null = fleet default. */
  agentOrder: string | null;
};

export function getActiveCity(prefs: UserPreferencesData | null): string {
  if (prefs?.currentCity) {
    // Expiry is optional — only skip if explicitly set AND already past.
    if (!prefs.currentCityUntil || new Date(prefs.currentCityUntil) >= new Date()) {
      return prefs.currentCity;
    }
  }
  return prefs?.homeCity ?? WEATHER_CITY;
}

export function getActiveTimezone(prefs: UserPreferencesData | null): string {
  if (prefs?.currentTimezone) {
    // Same expiry logic as getActiveCity — tied to currentCityUntil.
    if (!prefs.currentCityUntil || new Date(prefs.currentCityUntil) >= new Date()) {
      return prefs.currentTimezone;
    }
  }
  return prefs?.homeTimezone ?? DEFAULT_TIMEZONE;
}

export async function getUserPreferences(userId: string): Promise<UserPreferencesData> {
  const row = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row)
    return {
      homeCity: null,
      homeTimezone: null,
      homeLocale: null,
      currentCity: null,
      currentTimezone: null,
      currentCityUntil: null,
      writingVoice: null,
      memoryEnabled: true,
      agentOrder: null,
    };

  return {
    homeCity: row.homeCity,
    homeTimezone: row.homeTimezone,
    homeLocale: row.homeLocale,
    currentCity: row.currentCity,
    currentTimezone: row.currentTimezone,
    currentCityUntil: row.currentCityUntil,
    writingVoice: row.writingVoice,
    memoryEnabled: row.memoryEnabled,
    agentOrder: row.agentOrder,
  };
}

export async function upsertUserPreferences(
  userId: string,
  patch: Partial<UserPreferencesData>,
): Promise<UserPreferencesData> {
  const existing = await getUserPreferences(userId);
  const merged = { ...existing, ...patch };

  await db
    .insert(userPreferences)
    .values({ userId, ...toRow(merged) })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { ...toRow(merged), updatedAt: new Date() },
    });

  return merged;
}

function toRow(d: UserPreferencesData) {
  return {
    homeCity: d.homeCity,
    homeTimezone: d.homeTimezone,
    homeLocale: d.homeLocale,
    currentCity: d.currentCity,
    currentTimezone: d.currentTimezone,
    currentCityUntil: d.currentCityUntil,
    writingVoice: d.writingVoice,
    memoryEnabled: d.memoryEnabled,
    agentOrder: d.agentOrder,
  };
}
