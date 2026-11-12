import type { AgentTokenKind } from "@/db/schema/agent-tokens";

/**
 * May a token of this kind act as a builder — claim and ack commands, post a
 * PTY's frames, transcript, runtime state and a run's progress?
 *
 * Pure, so the rule is pinned by scripts/test/agent-token-kind.ts without a
 * database. getRunnerApiUserId (lib/session) applies it.
 */
export function tokenMayActAsRunner(kind: AgentTokenKind): boolean {
  return kind !== "agent";
}
