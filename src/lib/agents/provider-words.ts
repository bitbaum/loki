/**
 * Plain words for one provider row in Settings → AI providers.
 *
 * The runner reports a `nextAction` meant for whoever administers the machine:
 * env var names, server paths, install commands and the provider's own error
 * output, ANSI colour codes included. Shown as the row's line, the owner read
 * "add OPENROUTER_API_KEY to the cloud runner's env (/opt/loki/runner/.env)"
 * and "␛[91mError: ␛[0mInvalid API Key" with nothing they could act on.
 *
 * So the row's line is derived here from the measured FACTS (installed, signed
 * in, answered a test prompt), and the runner's text is kept, cleaned, for a
 * collapsed "Technical details" — still there for whoever fixes the machine.
 */
import type { ProviderInventoryEntry } from "./provider-inventory";

export type ProviderFacts = Pick<
  ProviderInventoryEntry,
  "kind" | "installed" | "auth" | "probe" | "healthy" | "nextAction" | "version"
> & { quota?: string | null };

/** Where the runner lives, in the owner's words. */
export function runnerName(channel: string): string {
  return channel === "cloud" ? "Loki's computer" : "Your computer";
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** Strip terminal colour codes (and the visible ␛ some logs carry instead). */
export function stripAnsi(s: string): string {
  return s
    .replace(ANSI, "")
    .replace(/␛\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const QUOTA = /quota|rate.?limit|429|exhaust|usage limit/i;
const SIGNED_OUT = /auth|oauth|expired|log ?in|sign ?in|unauthori[sz]ed|forbidden|401|403/i;
const KEY_REFUSED = /api.?key|invalid.*key|key.*invalid/i;

/**
 * Not set up at all on this computer: no program, or no way to sign in. These
 * are facts, not faults, and they are folded behind "Show N more".
 */
export function isUnused(p: ProviderFacts): boolean {
  if (p.quota || p.healthy) return false;
  if (p.kind === "cli" && !p.installed) return true;
  return p.auth === "none" && !p.probe;
}

/** The row's one line: what is true, then what to do, without builder words. */
export function providerPlainLine(p: ProviderFacts, channel: string): string {
  const where = channel === "cloud" ? "Loki's computer" : "your computer";
  if (p.quota) return "Used up for now. Loki uses another one until it resets.";
  if (p.healthy) return p.version ? `Working · version ${p.version}` : "Working";
  if (p.kind === "cli" && !p.installed) return `Not set up on ${where}`;
  if (p.auth === "none") {
    return channel === "cloud"
      ? "Not set up on Loki's computer"
      : "Signed out. Open it once on your computer to sign in again.";
  }
  if (p.probe && !p.probe.ok) {
    const detail = stripAnsi(p.probe.detail);
    if (QUOTA.test(detail)) return "Used up for now. Loki uses another one until it resets.";
    if (KEY_REFUSED.test(detail)) return "Its key was refused";
    if (SIGNED_OUT.test(detail)) {
      return channel === "cloud"
        ? "Signed out on Loki's computer"
        : "Signed out. Open it once on your computer to sign in again.";
    }
    return "Did not answer when Loki tried it";
  }
  return "Not tried yet";
}

/** The runner's own instruction, cleaned, for "Technical details" — or null. */
export function providerTechnicalDetail(p: ProviderFacts): string | null {
  const raw = p.nextAction ?? (p.probe && !p.probe.ok ? p.probe.detail : null);
  if (!raw) return null;
  const clean = stripAnsi(raw);
  return clean || null;
}

/** A runner that has not reported for this long is shown as out of date. */
export const RUNNER_STALE_MS = 60 * 60 * 1000;

export function isRunnerStale(observedAt: string, now: number = Date.now()): boolean {
  const t = new Date(observedAt).getTime();
  return !Number.isFinite(t) || now - t > RUNNER_STALE_MS;
}
