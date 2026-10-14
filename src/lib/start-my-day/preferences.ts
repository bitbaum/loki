/** Personal priorities never change another member's priorities or repository identity. */
export type DayPreferences = { mainProjectIds: string[]; labels: Record<string, string> };
export function readDayPreferences(value: unknown): DayPreferences {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const ids = Array.isArray(raw.mainProjectIds)
    ? raw.mainProjectIds.filter((id): id is string => typeof id === "string")
    : [];
  const labels: Record<string, string> = {};
  if (raw.labels && typeof raw.labels === "object") {
    for (const [id, label] of Object.entries(raw.labels)) {
      if (typeof label === "string" && label.trim()) labels[id] = label.trim().slice(0, 100);
    }
  }
  return { mainProjectIds: [...new Set(ids)], labels };
}
