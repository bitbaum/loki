import { pgTable, uuid, text, timestamp, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./users";
import type { RunnerChannel } from "./pending-commands";
import type { ProviderInventoryEntry } from "@/lib/agents/provider-inventory";

/**
 * One row per owned PTY the runner observed in the last heartbeat — a
 * topology report, nothing more. The cold-start restore that regenerated a
 * terminal layout from these panes was retired with zellij (2026-09-11);
 * nothing reads this back as desired state any more.
 *
 * Per-pane (not per-tab) is kept so the wire shape stays compatible with
 * runners that predate the retirement.
 */
export type PaneRecord = {
  /** Agent terminal name (already used as project key in user_projects.name). */
  tab: string;
  /** 0..N within the tab. Pane order as the runner reported it. */
  paneIndex: number;
  /** Agent CLI id ("claude" | "codex" | "cursor" | "gemini" | "grok"). Undefined = shell pane. */
  agentCli?: string;
  /** Working directory of the pane (from /proc/<pid>/cwd cross-ref). */
  cwd?: string;
  /** Terminal session name as reported by pre-0.8.19 runners; owned PTYs
   *  report none. Defaults to "fleet" if absent. */
  sessionName?: string;
};

/** Latest agent-terminal list pushed by the local runner (cloud control plane). */
export const runtimeSnapshots = pgTable(
  "runtime_snapshots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").$type<RunnerChannel>().notNull().default("local"),
    openTabs: text("open_tabs").array().notNull().default([]),
    installedAgents: text("installed_agents").array().notNull().default([]),
    runnerVersion: text("runner_version"),
    /** Measured provider inventory from the runner's heartbeat (src/lib/agents/provider-inventory.ts). Null = runner predates it. */
    providerInventory: jsonb("provider_inventory").$type<ProviderInventoryEntry[]>(),
    /**
     * Per-pane topology as the runner last reported it. Heartbeat report
     * only: the cold-start restore that treated this as "desired state" is
     * retired (2026-09-11), so nothing regenerates anything from it. Empty
     * array means no panes observed (legacy snapshots upgrade transparently).
     */
    panes: jsonb("panes").$type<PaneRecord[]>().notNull().default([]),
    /**
     * Wall power vs battery, as the runner last observed it.
     *
     * Not trivia — it is the only signal that says whether this builder will
     * still exist in twenty minutes. A laptop on wall power stays awake (its lid
     * action is "do nothing" on AC); the same laptop on battery sleeps the moment
     * the lid shuts and dies when the charge runs out. Dispatching a long agent
     * run to it from a phone is a coin flip.
     *
     * NULLABLE, and null means UNKNOWN — never "battery". Runners predating this
     * field report nothing, and demoting them would silently stop every
     * un-upgraded desktop from receiving work (fatal for accounts with no cloud
     * builder to fall back to). Routing may only act on positive knowledge.
     *
     * Freshness comes free: this rides the same row as `observedAt`, so a stale
     * "ac" expires with the heartbeat instead of vouching for a sleeping laptop.
     */
    powerSource: text("power_source").$type<"ac" | "battery">(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.channel] })],
);

export type RuntimeSnapshot = typeof runtimeSnapshots.$inferSelect;
export type NewRuntimeSnapshot = typeof runtimeSnapshots.$inferInsert;
