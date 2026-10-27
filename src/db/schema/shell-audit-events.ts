import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The plain shell's audit trail (docs/architecture/plain-shell.md).
 *
 * One row per fact: unlocked, opened, closed, refused, started on the builder,
 * ended there. Who, when, from where, on which builder and tab, and how it
 * ended. NEVER a command, a keystroke or a line of output — the trail says a
 * shell existed, not what was typed in it.
 *
 * Append-only by use: no code path updates or deletes a row
 * (scripts/test/shell-audit.ts fails if one appears). The database does not
 * forbid it — a trigger would also block an account's deletion cascade — so
 * this is an honest log of the app's behaviour, not a tamper-proof ledger.
 * Every row is also written to the app's journal (`[shell-audit]`).
 */
export const shellAuditEvents = pgTable(
  "shell_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    /** Which builder: "cloud" or "local". */
    channel: text("channel"),
    tab: text("tab"),
    /** Address the request came from (X-Forwarded-For via Caddy), and the browser. */
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** A refusal code, an exit code, a host name — never content. */
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_shell_audit_user_time").on(table.userId, table.createdAt)],
);

export type ShellAuditRow = typeof shellAuditEvents.$inferSelect;
