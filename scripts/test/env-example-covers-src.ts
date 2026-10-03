/**
 * `.env.example` is the contract a copy of this repo is configured from. Every
 * variable `src/` reads must be named there, with the file that reads it.
 *
 * Before this gate, 70 of them were not: a fork found the switch for Google
 * sign-in, embeddings, the Telegram bot or the daemon token only by grepping
 * `process.env`. A variable may be documented commented out (`# KEY=`): the
 * contract is the NAME and where it is read, not a value. Dynamic reads
 * (`process.env[name]`) are the helpers that take the name as an argument and
 * are not caught here by design.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NOT_CONFIG = new Set([
  "NODE_ENV",
  "NEXT_RUNTIME",
  "HOME",
  "PATH",
  "NEXT_PUBLIC_",
  "NEXT_PUBLIC_X",
]);

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(name)) yield p;
  }
}

const example = readFileSync(".env.example", "utf8");
const named = new Set([...example.matchAll(/^#?\s*([A-Z0-9_]+)=/gm)].map((m) => m[1]));
const read = new Map<string, string>();
for (const file of files("src")) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    // A comment that mentions a variable is not a read of it.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const m of line.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!read.has(m[1])) read.set(m[1], file);
    }
  }
}
const missing = [...read]
  .filter(([k]) => !named.has(k) && !NOT_CONFIG.has(k))
  .map(([k, f]) => `${k} (read by ${f})`);
assert.deepEqual(
  missing,
  [],
  `add each to .env.example (a \`# KEY=\` line with the reader is enough):\n${missing.join("\n")}`,
);
console.log(`env-example-covers-src: ${read.size} variables read, all named`);
