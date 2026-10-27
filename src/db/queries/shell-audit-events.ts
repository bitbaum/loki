import { db } from "@/db";
import { shellAuditEvents } from "@/db/schema/shell-audit-events";
import type { ShellAuditEvent } from "@/lib/shell-session";

export type ShellAuditInput = {
  userId: string;
  event: ShellAuditEvent;
  channel?: "cloud" | "local" | null;
  tab?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, string | number | boolean | null>;
};

/** Append one fact. Never throws: an audit write must not be the reason a
 *  refusal or a close fails — but it is logged to the journal first, so the
 *  record exists even if the database does not take it. */
export async function recordShellAudit(input: ShellAuditInput): Promise<void> {
  const row = {
    userId: input.userId,
    event: input.event,
    channel: input.channel ?? null,
    tab: input.tab ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
    detail: input.detail ?? null,
  };
  console.info(`[shell-audit] ${JSON.stringify({ ...row, at: new Date().toISOString() })}`);
  try {
    await db.insert(shellAuditEvents).values(row);
  } catch (e) {
    console.error("[shell-audit] could not write the row:", e instanceof Error ? e.message : e);
  }
}
