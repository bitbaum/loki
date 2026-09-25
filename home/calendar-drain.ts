#!/usr/bin/env -S npx tsx
/**
 * Calendar drain — the local half of calendar booking.
 *
 * Calendar events are booked through the locally-authenticated `gog` CLI, which
 * only exists on the operator's machine. Approvals, however, usually happen on
 * the cloud control plane (phone/browser) where `gog` isn't present — so those
 * approved events sit in the `actions` queue at status='approved', unbooked.
 *
 * This process closes that gap. It runs on the local machine and:
 *   1. GET  /api/actions/drain-events  → approved-but-unbooked calendar events
 *   2. for each, book it locally via `gog calendar create` (bookCalendarEvent)
 *   3. POST /api/actions/drain-events  → report the outcome; cloud marks executed
 *
 * It also pushes the calendar the OTHER way, for the same reason it exists at
 * all: the cloud cannot see `gog`. Without a mirror, an approval card could ask
 * "book Thursday 14:30?" while Thursday 14:30 was already taken — and on
 * 2026-09-17 it did exactly that, silently. So every few minutes:
 *
 *   4. `gog calendar list --json` → POST /api/calendar/busy (what is occupied)
 *
 * That half is one-way and lossy on purpose: start, end, title. No attendees,
 * no descriptions, no locations leave this machine.
 *
 * The `actions` table stays the single source of truth — nothing is copied into
 * a second queue. A booked row drops out of the GET list on the next pass, so
 * re-polling is safe and idempotent.
 *
 * Config (env):
 *   LOKI_API_URL     cloud app base URL   (default: the APP_URL constant)
 *   LOKI_AGENT_TOKEN ck_* token from /settings → Agent tokens (required)
 *   LOKI_DRAIN_INTERVAL_MS  poll cadence (default 15000)
 *   LOKI_BUSY_SYNC_INTERVAL_MS  calendar mirror cadence (default 300000)
 *   LOKI_BUSY_SYNC_DAYS     how far ahead to mirror (default 45)
 *
 * Run:    LOKI_AGENT_TOKEN=ck_… npx tsx home/calendar-drain.ts --start
 * Test:   npx tsx home/calendar-drain.ts --self-test   (pure logic, no I/O)
 */
import { APP_URL } from "@/config/brand";
import {
  bookCalendarEvent,
  recoverEventPayloadFromText,
  resolveEventTimes,
  buildGogCreateArgs,
} from "@/lib/actions/calendar-event";
import type { ActionPayload } from "@/db/schema/actions";
import { runToolArgs } from "@/lib/tools";

type DrainEvent = { id: string; title: string; payload: ActionPayload | null };

/**
 * Where to reach the cloud drain endpoint and how to auth. Standalone CLI use
 * fills these from env; the embedded desktop runner passes them explicitly from
 * its own token store + base-URL resolution so we don't duplicate the protocol.
 */
export type DrainConfig = { baseUrl?: string; token?: string };

function baseUrl(cfg?: DrainConfig): string {
  return (cfg?.baseUrl ?? process.env.LOKI_API_URL ?? APP_URL).replace(/\/$/, "");
}

function authHeader(cfg?: DrainConfig): Record<string, string> {
  const token = (cfg?.token ?? process.env.LOKI_AGENT_TOKEN)?.trim();
  if (!token)
    throw new Error("LOKI_AGENT_TOKEN is required (mint a ck_* token at /settings → Agent tokens)");
  return { authorization: `Bearer ${token}` };
}

/** One drain pass: fetch approved events, book each, report back. Returns count booked. */
export async function drainOnce(cfg?: DrainConfig): Promise<{ booked: number; failed: number }> {
  const base = baseUrl(cfg);
  const auth = authHeader(cfg);
  const res = await fetch(`${base}/api/actions/drain-events`, { headers: auth });
  if (!res.ok) throw new Error(`drain GET failed: ${res.status} ${res.statusText}`);
  const { events } = (await res.json()) as { events: DrainEvent[] };

  let booked = 0;
  let failed = 0;
  for (const ev of events ?? []) {
    // The drain runs on the operator's own machine and books events a person
    // approved; recovering an unstructured date there is part of that ask.
    const result = await bookCalendarEvent(ev.payload, ev.title, recoverEventPayloadFromText);
    const body = result.ok
      ? { id: ev.id, ok: true as const, eventId: result.eventId, htmlLink: result.htmlLink }
      : { id: ev.id, ok: false as const, error: result.error };
    await fetch(`${base}/api/actions/drain-events`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (result.ok) {
      booked++;
      console.log(
        `[calendar-drain] booked "${ev.title}"${result.htmlLink ? ` → ${result.htmlLink}` : ""}`,
      );
    } else {
      failed++;
      console.error(`[calendar-drain] failed "${ev.title}": ${result.error}`);
    }
  }
  return { booked, failed };
}

/** What `gog calendar list --json` gives us, reduced to the fields we mirror. */
type GogEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

/**
 * Normalise one gog event into a busy block.
 *
 * All-day events arrive as `date` (no time) and timed ones as `dateTime`; the
 * mirror stores instants either way, and Google's all-day `end` is already
 * exclusive so it needs no adjustment. Returns null for anything we cannot
 * place on a timeline — an event with no usable time cannot make a slot busy,
 * and guessing one would invent a clash that does not exist.
 */
export function toBusyBlock(ev: GogEvent): {
  eventId: string;
  summary: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
} | null {
  const id = ev.id?.trim();
  if (!id) return null;
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  const rawStart = ev.start?.dateTime ?? ev.start?.date;
  const rawEnd = ev.end?.dateTime ?? ev.end?.date;
  if (!rawStart || !rawEnd) return null;

  const startMs = Date.parse(allDay ? `${rawStart}T00:00:00Z` : rawStart);
  const endMs = Date.parse(allDay ? `${rawEnd}T00:00:00Z` : rawEnd);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;

  return {
    eventId: id,
    summary: ev.summary?.trim() || null,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    allDay,
  };
}

/**
 * Mirror the next N days of the calendar to the cloud.
 *
 * An EMPTY list is a real result and is sent as one: it means "I looked and
 * that window is free", which must clear the mirror. Suppressing it would leave
 * a cancelled week showing as busy forever. A gog FAILURE is different and must
 * not be confused with it — we throw, send nothing, and let the mirror go stale
 * rather than report an empty diary we never actually saw.
 */
export async function syncBusyOnce(cfg?: DrainConfig): Promise<{ sent: number; days: number }> {
  const days = Number(process.env.LOKI_BUSY_SYNC_DAYS ?? 45);
  const res = await runToolArgs(
    process.env.GOG_BIN?.trim() || "gog",
    ["calendar", "list", "--json", "--days", String(days)],
    20000,
  );
  if (!res.ok) throw new Error(res.error ?? "gog calendar list failed");

  const parsed = JSON.parse(res.data ?? "[]");
  const raw: GogEvent[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.events)
      ? parsed.events
      : [];
  const events = raw.map(toBusyBlock).filter((b): b is NonNullable<typeof b> => b !== null);

  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + days * 24 * 60 * 60 * 1000);

  const post = await fetch(`${baseUrl(cfg)}/api/calendar/busy`, {
    method: "POST",
    headers: { ...authHeader(cfg), "content-type": "application/json" },
    body: JSON.stringify({
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      events,
    }),
  });
  if (!post.ok) throw new Error(`busy sync failed: ${post.status} ${post.statusText}`);
  return { sent: events.length, days };
}

async function start(): Promise<void> {
  const interval = Number(process.env.LOKI_DRAIN_INTERVAL_MS ?? 15000);
  const busyInterval = Number(process.env.LOKI_BUSY_SYNC_INTERVAL_MS ?? 300000);
  authHeader(); // fail fast if token missing
  console.log(`[calendar-drain] polling ${baseUrl()}/api/actions/drain-events every ${interval}ms`);

  // The mirror runs on its own, slower clock. Booking wants to be prompt (the
  // operator is waiting); mirroring is a cache refresh, and shelling out to gog
  // every 15s to learn nothing changed is pure waste on a laptop.
  let nextBusySync = 0;

  for (;;) {
    try {
      await drainOnce();
    } catch (e) {
      console.error(`[calendar-drain] pass errored:`, e instanceof Error ? e.message : e);
    }

    if (Date.now() >= nextBusySync) {
      try {
        const { sent, days } = await syncBusyOnce();
        console.log(`[calendar-drain] mirrored ${sent} event(s) over ${days}d`);
        nextBusySync = Date.now() + busyInterval;
      } catch (e) {
        // Retry on the next pass rather than backing off to the full interval:
        // a stale mirror silently degrades the conflict warning, so the sooner
        // it recovers the better. It is never fatal to booking.
        console.error(`[calendar-drain] busy sync failed:`, e instanceof Error ? e.message : e);
      }
    }

    await new Promise((r) => setTimeout(r, interval));
  }
}

// ── Inline self-test (pure time/arg resolution — the bug-prone part) ──────────
// Run with: npx tsx home/calendar-drain.ts --self-test
function selfTest(): void {
  let pass = 0;
  const cases: Array<[string, boolean]> = [];
  const check = (name: string, cond: boolean) => {
    cases.push([name, cond]);
    if (cond) pass++;
  };

  // All-day from a bare date → date-only from/to, end exclusive (next day).
  const allDay = resolveEventTimes({ eventDate: "2026-07-14" });
  check("bare date ⇒ all-day", allDay?.allDay === true);
  check("all-day from = the day", allDay?.from === "2026-07-14");
  check("all-day end is exclusive next day", allDay?.to === "2026-07-15");

  // Explicit start+end → precise instants, not all-day.
  const timed = resolveEventTimes({
    eventStart: "2026-07-14T09:00:00+02:00",
    eventEnd: "2026-07-14T17:00:00+02:00",
  });
  check("start+end ⇒ timed", timed?.allDay === false);
  check("timed from preserved as instant", timed?.from === "2026-07-14T07:00:00.000Z");
  check("timed to preserved as instant", timed?.to === "2026-07-14T15:00:00.000Z");

  // Start with no end → default 1-hour block.
  const oneHour = resolveEventTimes({ eventStart: "2026-07-14T09:00:00Z" });
  check("start-only ⇒ +1h end", oneHour?.to === "2026-07-14T10:00:00.000Z");

  // End before start is ignored → falls back to +1h.
  const badEnd = resolveEventTimes({
    eventStart: "2026-07-14T09:00:00Z",
    eventEnd: "2026-07-14T08:00:00Z",
  });
  check("end<start ignored ⇒ +1h", badEnd?.to === "2026-07-14T10:00:00.000Z");

  // Forced all-day even with a datetime.
  const forced = resolveEventTimes({ eventStart: "2026-07-14T09:00:00Z", allDay: true });
  check("allDay flag forces all-day", forced?.allDay === true && forced?.from === "2026-07-14");

  // No usable time → null (caller must not book).
  check("no date/time ⇒ null", resolveEventTimes({ eventTitle: "x" }) === null);

  // Arg builder: summary/from/to present; --all-day + --location appended correctly.
  const args = buildGogCreateArgs(
    { eventTitle: "revampit storage", eventDate: "2026-07-14", eventLocation: "Zurich" },
    "fallback",
  );
  check(
    "args start with calendar create primary",
    args?.slice(0, 3).join(" ") === "calendar create primary",
  );
  check("args carry --summary", args?.[args.indexOf("--summary") + 1] === "revampit storage");
  check("args carry --all-day", args?.includes("--all-day") === true);
  check("args carry --location", args?.[args.indexOf("--location") + 1] === "Zurich");

  // Falls back to action title when payload has no eventTitle.
  const argsFb = buildGogCreateArgs({ eventDate: "2026-07-14" }, "Team sync");
  check(
    "title falls back to action title",
    argsFb?.[argsFb.indexOf("--summary") + 1] === "Team sync",
  );

  // Unbookable payload → null args.
  check("no time ⇒ null args", buildGogCreateArgs({ eventTitle: "x" }, "") === null);

  // ── Calendar mirror: gog event → busy block ───────────────────────────────
  // The conflict warning is only as good as this normalisation, and the
  // dangerous direction is INVENTING a block (a phantom clash on a free slot
  // trains the operator to ignore the warning), so the null cases are asserted
  // as hard as the positive ones.
  const timedBlock = toBusyBlock({
    id: "abc",
    summary: "Gespräch Simon",
    start: { dateTime: "2026-09-24T15:00:00+02:00" },
    end: { dateTime: "2026-09-24T16:00:00+02:00" },
  });
  check("timed event mirrors as non-all-day", timedBlock?.allDay === false);
  check("timed start is an instant", timedBlock?.startsAt === "2026-09-24T13:00:00.000Z");
  check("timed summary carried", timedBlock?.summary === "Gespräch Simon");

  const allDayBlock = toBusyBlock({
    id: "def",
    summary: "Autechre",
    start: { date: "2026-09-25" },
    end: { date: "2026-09-26" },
  });
  check("date-only event mirrors as all-day", allDayBlock?.allDay === true);
  check("all-day end stays exclusive", allDayBlock?.endsAt === "2026-09-26T00:00:00.000Z");

  check("event with no id is dropped", toBusyBlock({ start: { date: "2026-09-25" } }) === null);
  check("event with no times is dropped", toBusyBlock({ id: "x", summary: "y" }) === null);
  check(
    "end before start is dropped",
    toBusyBlock({
      id: "x",
      start: { dateTime: "2026-09-24T16:00:00Z" },
      end: { dateTime: "2026-09-24T15:00:00Z" },
    }) === null,
  );
  check(
    "zero-length event is dropped (it makes nothing busy)",
    toBusyBlock({
      id: "x",
      start: { dateTime: "2026-09-24T15:00:00Z" },
      end: { dateTime: "2026-09-24T15:00:00Z" },
    }) === null,
  );
  check(
    "untitled event still mirrors (the slot is taken either way)",
    toBusyBlock({
      id: "z",
      start: { dateTime: "2026-09-24T09:00:00Z" },
      end: { dateTime: "2026-09-24T10:00:00Z" },
    })?.summary === null,
  );

  for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
  const total = cases.length;
  if (pass !== total) {
    console.error(`\n${pass}/${total} passed`);
    process.exit(1);
  }
  console.log(`\n${pass}/${total} passed`);
}

const isDirectCli = process.argv[1]?.endsWith("calendar-drain.ts");
if (isDirectCli) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else if (process.argv.includes("--start")) {
    void start();
  } else {
    console.log(`calendar-drain — book cloud-approved calendar events on the local machine.

  npx tsx home/calendar-drain.ts --start        run the poll loop (needs gog + LOKI_AGENT_TOKEN)
  npx tsx home/calendar-drain.ts --self-test    run inline tests, no I/O`);
  }
}
