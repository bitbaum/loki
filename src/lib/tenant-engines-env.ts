/**
 * A private builder's unit env file: the agent CLIs' own variables for the
 * keys the person marked "also for building", nothing else. Pure, so the
 * test and the box script (scripts/write-tenant-engines.ts) share one
 * renderer without the script's database import.
 */

/** `NAME="value"` lines, sorted; a value is quoted so systemd reads it verbatim. */
export function renderEnvFile(keys: { env: string; value: string }[]): string {
  const lines = keys
    .slice()
    .sort((a, b) => a.env.localeCompare(b.env))
    .map((k) => `${k.env}="${k.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}
