/**
 * The spool: a message is written here BEFORE the gateway tells the sender
 * "accepted", so nothing it said yes to can be lost — not to a crashed app, a
 * restart, or a deploy. Delivery reads from here and moves each message to
 * done/ once the app has stored it.
 *
 * The gateway is a relay, not an archive: once an app has a message, the app's
 * own retention rules it (Skif deletes after 90 days), so the gateway's copy
 * and its raw source are pruned after `prune`'s window. Undelivered mail is
 * never pruned.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { InboundMail } from "@bitbaum/mail-kit";

export interface Spooled {
  mail: InboundMail;
  port: number;
  attempts: number;
  /** Epoch ms after which to try again. */
  nextAt: number;
  lastError?: string;
}

export class Spool {
  constructor(readonly dir: string) {
    for (const d of ["pending", "done", "raw"])
      mkdirSync(join(dir, d), { recursive: true, mode: 0o700 });
  }

  /** The raw message, kept so attachments can be fetched later. */
  saveRaw(id: string, raw: Buffer): void {
    writeFileSync(join(this.dir, "raw", `${id}.eml`), raw, { mode: 0o600 });
  }

  put(entry: Spooled): void {
    const file = join(this.dir, "pending", `${entry.mail.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(entry), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  pending(): Spooled[] {
    return readdirSync(join(this.dir, "pending"))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          return [JSON.parse(readFileSync(join(this.dir, "pending", f), "utf8")) as Spooled];
        } catch {
          return [];
        }
      });
  }

  done(id: string): void {
    renameSync(join(this.dir, "pending", `${id}.json`), join(this.dir, "done", `${id}.json`));
  }

  /** Delete delivered entries, and raw copies of delivered mail, older than
   * `keepDays`. Returns how many files went. */
  prune(keepDays: number, now = Date.now()): number {
    const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    const sweep = (sub: "done" | "raw", ext: string) => {
      for (const f of readdirSync(join(this.dir, sub))) {
        if (!f.endsWith(ext)) continue;
        const id = f.slice(0, -ext.length);
        if (sub === "raw" && existsSync(join(this.dir, "pending", `${id}.json`))) continue;
        const path = join(this.dir, sub, f);
        if (statSync(path).mtimeMs < cutoff) {
          unlinkSync(path);
          removed++;
        }
      }
    };
    sweep("done", ".json");
    sweep("raw", ".eml");
    return removed;
  }
}
