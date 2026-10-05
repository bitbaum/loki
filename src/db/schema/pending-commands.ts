import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import type { BuilderChannel } from "@/lib/constants/statuses";
import type { AgentImage } from "@/lib/agent-attachments";

// Commands queued by the cloud control plane for the local runtime node to execute.
// The local runner polls this table, claims rows, executes them via zellij, and marks them done.
export const pendingCommands = pgTable(
  "pending_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "inject" | "close_tab" | "launch_agent" | "switch_agent" | "peek_tab" | ...
    payload: jsonb("payload").notNull(), // command-specific fields
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: jsonb("result"), // { ok: boolean, error?: string }
  },
  (table) => [
    index("idx_pending_commands_user_id").on(table.userId),
    index("idx_pending_commands_created_at").on(table.createdAt),
    // The claim gate, purge exemption, and close-sweep undelivered check all
    // probe unexecuted commands by payload.runId — partial expression index so
    // those stay cheap as the table grows.
    index("idx_pending_commands_open_run")
      .on(sql`((payload->>'runId'))`)
      .where(sql`executed_at IS NULL`),
  ],
);

export type PendingCommand = typeof pendingCommands.$inferSelect;
export type NewPendingCommand = typeof pendingCommands.$inferInsert;

export type InjectPayload = {
  tab: string;
  /** Optional runner target. Cloud-host dispatches default this to "cloud". */
  channel?: RunnerChannel;
  prompt: string;
  /** Screenshots for the agent, written to files by the runner, whose paths
   *  replace the prompt's placeholders (lib/agent-attachments). */
  attachments?: AgentImage[];
  promptKey?: string;
  promptLabel?: string;
  adapter?: string;
  /**
   * Model override for the dispatched agent (e.g. "opus", "flash", "gpt-5").
   * The runner's execute_inject auto-launch reads this when the target tab has
   * no live agent and prefers it over the conf-file model. Matches the shape
   * already used by LaunchAgentPayload/SwitchAgentPayload — adding it here so
   * /api/inject can honor user_projects.modelPref end-to-end.
   */
  model?: string;
  projectId?: string | null;
  projectKey?: string;
  /**
   * Orchestration run id created on the cloud side at dispatch time. The local
   * runner writes /tmp/cockpit-run-<tab> with this value before injecting so
   * agent-hook-bridge.sh:handle_stop can call /api/orchestration/runs/<id>/finish
   * when the agent's session ends. Closes the outcome-tracking loop in cloud mode.
   */
  runId?: string;
  /** Native Claude session to resume if this command must launch a PTY. */
  sessionId?: string;
};

export type SwitchAgentPayload = {
  tab: string;
  /** Optional runner target. When set, only that builder channel may claim it. */
  channel?: RunnerChannel;
  dir: string;
  toAgent: string;
  fromAgent?: string;
  model?: string;
};

export type AutoContinuePayload = {
  tab: string;
  /** Optional runner target. When set, only that builder channel may claim it. */
  channel?: RunnerChannel;
  enabled: boolean;
};

/** Alias of the shared BuilderChannel union — kept so existing importers
 *  (routes, queries, execution-access) don't all have to change. */
export type RunnerChannel = BuilderChannel;

export type TabPayload = {
  tab: string;
  /** Optional runner target. When set, only that builder channel may claim it. */
  channel?: RunnerChannel;
};

export type LaunchAgentPayload = {
  tab: string;
  /** Optional runner target. When set, only that builder channel may claim it. */
  channel?: RunnerChannel;
  dir: string;
  agent: string;
  model?: string;
  initialPrompt?: string;
};

/**
 * The reliable product loop in one command: ensure the project's zellij tab,
 * launch `agent` there if none is running, then inject `prompt` — verified,
 * runner-side. Unlike InjectPayload (which assumes a live agent and silently
 * no-ops into a bare shell when there isn't one), `dispatch` always lands.
 */
export type DispatchPayload = {
  tab: string;
  /** Optional runner target. When set, only that builder channel may claim it. */
  channel?: RunnerChannel;
  dir: string;
  agent: string;
  prompt: string;
  /** Screenshots for the agent, written to files by the runner, whose paths
   *  replace the prompt's placeholders (lib/agent-attachments). */
  attachments?: AgentImage[];
  model?: string;
  promptKey?: string;
  promptLabel?: string;
  projectKey?: string;
  runId?: string;
  /** Native Claude session to resume if no live PTY already owns the project. */
  sessionId?: string;
};
