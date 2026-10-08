// useLocalStorageState must not write one key's value over another's when the
// key changes after mount.
//
// Found in the browser 2026-10-08: the terminal's tab layout/names are keyed per
// builder, the page first renders as "cloud" and switches to "local" once the
// saved source resolves; the hook hydrated once and kept writing the CURRENT
// value to the NEW key, so `tab-layout:local` was reset on every load and the
// cloud alias was copied under `tab-names:local`.
// Run: npx tsx scripts/test/local-storage-state-rekey.ts
import { readFileSync } from "fs";
import { join } from "path";
import { canPersist, readStored } from "@/hooks/use-local-storage-state";

let pass = 0;
let fail = 0;
function ok(cond: unknown, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// Nothing may be written before the key's own stored value has been read.
ok(!canPersist(null, "k:local"), "no write before any hydration");
ok(!canPersist("k:cloud", "k:local"), "no write to a key that has not been hydrated yet");
ok(canPersist("k:local", "k:local"), "write once this key has been hydrated");

// Simulate the page: the stored local value must survive a cloud -> local switch.
const store = new Map<string, string>([["k:local", '{"pinned":["a"]}']]);
const storage = { getItem: (k: string) => store.get(k) ?? null };
const parse = (raw: string) => JSON.parse(raw) as { pinned: string[] };
const empty = { pinned: [] as string[] };

let hydrated: string | null = null;
let value = empty;
let key = "k:cloud";
const written: string[] = [];
const effects = () => {
  // hydrate effect, then write effect, in the hook's order
  if (hydrated !== key) {
    value = readStored(storage, key, parse, empty);
    const wasHydrated = hydrated;
    hydrated = key;
    void wasHydrated; // the write effect of this pass saw the OLD hydrated key
    return;
  }
  const serialized = JSON.stringify(value);
  if (store.get(key) !== serialized) {
    store.set(key, serialized);
    written.push(key);
  }
};
effects(); // mount on cloud
effects(); // settled on cloud
key = "k:local"; // the source resolves after mount
effects(); // re-hydrates local
effects(); // settled on local
ok(eq(value.pinned, ["a"]), "the local key's stored value is read after the key changes");
ok(store.get("k:local") === '{"pinned":["a"]}', "the local key still holds what it held");
ok(!written.includes("k:local"), "the cloud value was never written to the local key");

// A key with nothing stored reads as the default, never as the previous key's value.
ok(eq(readStored(storage, "k:none", parse, empty).pinned, []), "an unset key reads as the default");
ok(
  readStored(
    {
      getItem: () => {
        throw new Error("blocked");
      },
    },
    "k",
    parse,
    empty,
  ) === empty,
  "unreadable storage reads as the default",
);

function eq(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The hook is wired to the rule, not a one-shot flag.
const src = readFileSync(join(process.cwd(), "src/hooks/use-local-storage-state.ts"), "utf8");
ok(/canPersist\(hydratedKey, key\)/.test(src), "the write effect is gated by canPersist");
ok(
  /\}, \[key\]\); \/\/ eslint-disable-line react-hooks\/exhaustive-deps/.test(src),
  "hydration re-runs when the key changes",
);

if (fail) {
  console.error(`local-storage-state-rekey: ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`local-storage-state-rekey: ${pass} passed`);
