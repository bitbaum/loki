/**
 * Before a builder launches an agent CLI, is it installed HERE?
 *
 * Without this a project set to Codex, dispatched to the cloud builder (which
 * has only Claude), started a terminal running `codex`, the shell answered
 * "command not found", and Loki reported the agent as not responding. The
 * builder that is about to launch it is the only one that knows, so the check
 * lives at the launch, and the refusal says what to do next.
 */
import { findAdapter } from "./index";

export type BuilderWhere = "cloud" | "local" | null;

const WHERE: Record<"cloud" | "local", string> = {
  cloud: "the cloud runner",
  local: "this computer",
};

/** The sentence a person reads when the agent is missing. */
export function agentNotInstalledMessage(label: string, where: BuilderWhere): string {
  const place = where ? WHERE[where] : "this runner";
  return (
    `${label} is not installed on ${place}, so nothing was started. ` +
    `Switch this project to an agent installed there, or install ${label} on ${place}, ` +
    `then try again.`
  );
}

/** Null when the agent can be launched here; otherwise why not, in words. */
export function missingAgentReason(agentId: string, where: BuilderWhere): string | null {
  const adapter = findAdapter(agentId);
  if (!adapter) return null; // unknown ids are refused elsewhere, with their own message
  return adapter.detectAvailable().available
    ? null
    : agentNotInstalledMessage(adapter.label, where);
}
