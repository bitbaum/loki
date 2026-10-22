/**
 * Which hosts receive mail, and where each app listens: read from the app
 * register (scripts/hetzner/apps.conf), the one list of sites on the box.
 * A host the register does not name gets no mail — the gateway can never
 * become a relay for anybody's domain.
 */
import { existsSync, readFileSync } from "node:fs";

/** Sites that are gone: their hosts stop receiving. */
const NOT_SERVED = new Set(["archived", "retired"]);

export type Register = ReadonlyMap<string, number>;

/** apps.conf rows: name|port|domains|repo|app_dir|db|owner|kind|status|… */
export function parseRegister(text: string): Register {
  const hosts = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const [, port, domains, , , , , , status] = line.split("|").map((c) => c.trim());
    const p = Number(port);
    if (!Number.isInteger(p) || p <= 0 || !domains || (status && NOT_SERVED.has(status))) continue;
    for (const d of domains.split(",")) {
      const host = d.trim().toLowerCase();
      if (host && !hosts.has(host)) hosts.set(host, p);
    }
  }
  return hosts;
}

/** Read every register in a colon-separated list that exists, as one: the
 * live copy each Loki deploy refreshes, plus the one installed beside the
 * gateway (so a missing live copy never leaves it with nothing). Throws only
 * when none can be read. */
export function loadRegister(paths: string, extra = ""): Register {
  const texts = paths
    .split(":")
    .filter((p) => p && existsSync(p))
    .map((p) => readFileSync(p, "utf8"));
  if (texts.length === 0) throw new Error(`no register found at ${paths}`);
  return parseRegister(`${texts.join("\n")}\n${extra}`);
}

/** The mailboxes every app has: its one address, plus the two RFC 2142 says
 * every domain that receives mail must accept. All three reach the app. */
export const MAILBOXES = new Set(["hello", "postmaster", "abuse"]);

/** `hello@skif.orangecat.ch` → the app's port, or undefined. */
export function routeFor(
  register: Register,
  address: string,
): { host: string; port: number } | undefined {
  const at = address.lastIndexOf("@");
  if (at < 1) return undefined;
  const local = address.slice(0, at).toLowerCase();
  const host = address.slice(at + 1).toLowerCase();
  const port = register.get(host);
  return MAILBOXES.has(local) && port ? { host, port } : undefined;
}
