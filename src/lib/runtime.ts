/**
 * Runtime availability — distinguishes the local machine (where owned PTYs and
 * agent CLIs run) from the cloud control plane (the hosted server, where only DB-backed operations work).
 *
 * Set RUNTIME_AVAILABLE=true in .env.local on the home machine.
 * Do NOT set it in the cloud host's env vars — its absence is the signal.
 */
export function isRuntimeAvailable(): boolean {
  return process.env.RUNTIME_AVAILABLE === "true";
}

/** Server-owned sandbox workspaces are an explicit hosted-execution opt-in. */
export function isSandboxExecutorEnabled(): boolean {
  return process.env.LOKI_EXECUTOR === "sandbox";
}

/**
 * Error body when the cloud control plane must not spawn local PTYs (Horizon A2).
 * A person can read it, so it says where to go, not how the server is built.
 */
export const WORKSPACES_CLOUD_DISABLED =
  "This page is not used on this Loki. Watch your agents work in Terminal.";
