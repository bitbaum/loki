import postgres from "postgres";
import { getDatabasePoolUrl } from "@/lib/db-url";

// Dispatch uses the ordinary DB pool internally. Holding its connections
// while waiting for dispatch would deadlock when five users start together.
// One separate, hot-reload-safe connection holds only the advisory lock.
const globalForDayLock = globalThis as unknown as {
  __lokiDayLock?: ReturnType<typeof postgres>;
  __lokiDayStarting?: Set<string>;
};

export async function withDayStartLock<T>(
  userId: string,
  run: () => Promise<T>,
): Promise<T | null> {
  const starting = (globalForDayLock.__lokiDayStarting ??= new Set<string>());
  if (starting.has(userId)) return null;
  starting.add(userId);
  try {
    const client = (globalForDayLock.__lokiDayLock ??= postgres(getDatabasePoolUrl(), {
      max: 1,
      idle_timeout: 20,
    }));
    const result = await client.begin(async (tx) => {
      const [lock] = await tx<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${`start-my-day:${userId}`}, 0)) AS acquired
    `;
      if (!lock?.acquired) return { value: null };
      return { value: await run() };
    });
    return result.value;
  } finally {
    starting.delete(userId);
  }
}
