/**
 * A schedule said in words, and the cron line it becomes.
 *
 * The Schedule Job dialog on /prompts asked a person on a phone to type
 * "0 9 * * 1" into a box, with three examples underneath (owner, 2026-10-20).
 * People pick "every weekday at 08:00"; Loki writes the cron. This module is
 * both directions — a pick to a cron line, and any cron line back to a
 * sentence when it has a common shape — plus the check that refuses a line
 * the scheduler would not understand, so the dialog can say what is wrong
 * before Create rather than after the first run never happens.
 *
 * Pure: no DB, no I/O. The dialog, the job list's labels (crons-shared) and
 * the API's validation all read it.
 */

export const SCHEDULE_KINDS = ["daily", "weekdays", "weekly", "monthly", "custom"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** Sunday first, as cron counts (0 = Sunday; 7 is Sunday too). */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Day-of-month picks stop at 28 so "every month" really is every month. */
export const MONTH_DAY_MAX = 28;

export type SchedulePick = {
  kind: ScheduleKind;
  /** "HH:MM", 24-hour — what <input type="time"> gives. */
  time: string;
  /** 0–6, Sunday = 0. Used by "weekly". */
  weekday: number;
  /** 1–28. Used by "monthly". */
  monthDay: number;
  /** The expert's own line. Used by "custom". */
  cron: string;
};

const DEFAULT_PICK: SchedulePick = {
  kind: "weekly",
  time: "09:00",
  weekday: 1,
  monthDay: 1,
  cron: "0 9 * * 1",
};

const pad = (n: number) => String(n).padStart(2, "0");

function parseTime(time: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** The cron line a pick stands for. A custom pick is its own line, trimmed. */
export function cronFromPick(pick: SchedulePick): string {
  if (pick.kind === "custom") return pick.cron.trim().replace(/\s+/g, " ");
  const t = parseTime(pick.time) ?? { h: 9, m: 0 };
  const at = `${t.m} ${t.h}`;
  switch (pick.kind) {
    case "daily":
      return `${at} * * *`;
    case "weekdays":
      return `${at} * * 1-5`;
    case "weekly":
      return `${at} * * ${pick.weekday}`;
    case "monthly":
      return `${at} ${pick.monthDay} * *`;
  }
}

const NUM = /^\d+$/;

/**
 * The pick a cron line came from, when it has one of the shapes the dialog
 * offers — so a prompt's suggested "0 10 * * 1" opens as "Weekly · Monday ·
 * 10:00" rather than as a line of digits. Anything else opens as Custom.
 */
export function pickFromCron(expr: string | null | undefined): SchedulePick {
  if (!expr?.trim()) return { ...DEFAULT_PICK };
  const line = expr.trim().replace(/\s+/g, " ");
  const custom: SchedulePick = { ...DEFAULT_PICK, kind: "custom", cron: line };
  if (cronProblem(line)) return custom;
  const [min, hour, dom, mon, dow] = line.split(" ");
  if (!NUM.test(min!) || !NUM.test(hour!) || mon !== "*") return custom;
  const base = { ...DEFAULT_PICK, time: `${pad(Number(hour))}:${pad(Number(min))}`, cron: line };
  if (dom === "*" && dow === "*") return { ...base, kind: "daily" };
  if (dom === "*" && dow === "1-5") return { ...base, kind: "weekdays" };
  if (dom === "*" && NUM.test(dow!)) return { ...base, kind: "weekly", weekday: Number(dow) % 7 };
  if (dow === "*" && NUM.test(dom!) && Number(dom) <= MONTH_DAY_MAX)
    return { ...base, kind: "monthly", monthDay: Number(dom) };
  return custom;
}

// ── Validation ───────────────────────────────────────────────────────────────

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of the month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  { name: "day of the week", min: 0, max: 7, names: DAY_NAMES, nameBase: 0 },
] as const;

function fieldValue(token: string, field: (typeof FIELDS)[number]): number | null {
  if (NUM.test(token)) return Number(token);
  if ("names" in field) {
    const i = (field.names as readonly string[]).indexOf(token.toLowerCase());
    if (i >= 0) return i + field.nameBase;
  }
  return null;
}

function fieldProblem(part: string, field: (typeof FIELDS)[number]): string | null {
  const bad = `The ${field.name} part, “${part}”, is not something a schedule understands.`;
  for (const item of part.split(",")) {
    const [range, step, extra] = item.split("/");
    if (extra !== undefined || range === "") return bad;
    if (step !== undefined && (!NUM.test(step) || Number(step) < 1)) return bad;
    if (range === "*") continue;
    const [lo, hi, more] = range!.split("-");
    if (more !== undefined) return bad;
    const a = fieldValue(lo!, field);
    const b = hi === undefined ? a : fieldValue(hi, field);
    if (a === null || b === null) return bad;
    if (a < field.min || b > field.max || a > b)
      return `The ${field.name} must be between ${field.min} and ${field.max} — “${part}” is not.`;
  }
  return null;
}

/**
 * Why a cron line would not run, in a sentence — or null when it is fine.
 * Five parts: minute, hour, day of the month, month, day of the week.
 */
export function cronProblem(expr: string): string | null {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5)
    return "A schedule line has five parts: minute, hour, day of the month, month, day of the week — e.g. “0 9 * * 1”.";
  for (let i = 0; i < 5; i++) {
    const problem = fieldProblem(parts[i]!, FIELDS[i]!);
    if (problem) return problem;
  }
  return null;
}

// ── Words ────────────────────────────────────────────────────────────────────

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "07:00, 11:00 and 15:00" from minute + hour parts, or null if not a plain list. */
function timesInWords(min: string, hour: string): string | null {
  if (!NUM.test(min)) return null;
  const hours = hour.split(",");
  if (!hours.every((h) => NUM.test(h))) return null;
  return joinWords(hours.map((h) => `${pad(Number(h))}:${pad(Number(min))}`));
}

function dayName(token: string): string | null {
  const day = fieldValue(token, FIELDS[4]);
  return day === null ? null : WEEKDAY_NAMES[day % 7]!;
}

/**
 * A cron line as a sentence, e.g. "Every Monday at 09:00", or null when it
 * has no common shape — the caller then shows the line itself rather than a
 * guess.
 */
export function describeCron(expr: string): string | null {
  const line = expr.trim().replace(/\s+/g, " ");
  if (cronProblem(line)) return null;
  const [min, hour, dom, mon, dow] = line.split(" ") as [string, string, string, string, string];
  if (mon !== "*") return null;
  const at = timesInWords(min, hour);
  if (!at) return null;
  if (dom === "*" && dow === "*") return `Every day at ${at}`;
  if (dom === "*" && dow === "1-5") return `Every weekday (Monday to Friday) at ${at}`;
  if (dom === "*" && (dow === "0,6" || dow === "6,0")) return `Every Saturday and Sunday at ${at}`;
  if (dom === "*") {
    const range = /^(\w+)-(\w+)$/.exec(dow);
    if (range) {
      const a = dayName(range[1]!);
      const b = dayName(range[2]!);
      return a && b ? `${a} to ${b} at ${at}` : null;
    }
    const days = dow.split(",").map(dayName);
    if (days.some((d) => d === null)) return null;
    return `Every ${joinWords(days as string[])} at ${at}`;
  }
  if (dow === "*" && NUM.test(dom)) return `On the ${ordinal(Number(dom))} of every month at ${at}`;
  return null;
}

/**
 * "Zurich time (Europe/Zurich)" — the place a person recognises, then the
 * exact zone the scheduler is told.
 */
export function timeZoneInWords(tz: string): string {
  const city = tz.includes("/") ? tz.split("/").pop()!.replace(/_/g, " ") : null;
  return city ? `${city} time (${tz})` : tz;
}
