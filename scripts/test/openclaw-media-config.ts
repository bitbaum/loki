/**
 * The chat agent's media-understanding block (scripts/openclaw/).
 *
 * WHAT THIS PINS
 *
 * OpenClaw's defaults cut every image and video description at 500 characters
 * and read one attachment per message. On those defaults a screenshot of a
 * chat or an error lost most of its text before the model saw it, and an album
 * of screenshots was read as its first picture. The block raises both; this
 * keeps a tidy-up from quietly putting them back.
 *
 * It also pins what the installer must NOT touch: tools.media.audio. Voice
 * notes already transcribe, and replacing a working STT chain for symmetry
 * would break them.
 *
 * The schema itself is checked where it can be — on the box, by the installed
 * OpenClaw's own `config set --strict-json` + `config validate`. This test has
 * no network and no OpenClaw; it checks the decisions, not the schema.
 *
 * Run: npx tsx scripts/test/openclaw-media-config.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = join(ROOT, "scripts/openclaw/media-understanding.json");
const INSTALLER = join(ROOT, "scripts/openclaw/install-media-understanding.sh");

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type Block = {
  enabled?: boolean;
  maxChars?: number;
  prompt?: string;
  attachments?: { mode?: string; maxAttachments?: number };
  models?: { provider?: string }[];
};
const config = JSON.parse(readFileSync(CONFIG, "utf8")) as Record<string, Block>;
const installer = readFileSync(INSTALLER, "utf8");

console.log("openclaw-media-config:");

check("configures exactly image and video — audio is left alone", () => {
  const keys = Object.keys(config).sort().join(",");
  assert(keys === "image,video", `expected image,video — got ${keys}`);
  assert(!/tools\.media\.audio\s+\S/.test(installer), "installer writes tools.media.audio");
});

check("THE BUG: a screenshot's text is not cut at the 500-char default", () => {
  assert((config.image.maxChars ?? 0) >= 4000, `image.maxChars ${config.image.maxChars}`);
  assert(/verbatim/i.test(config.image.prompt ?? ""), "image prompt must ask for text verbatim");
});

check("a video has room for a transcript and its claims", () => {
  assert((config.video.maxChars ?? 0) >= 10000, `video.maxChars ${config.video.maxChars}`);
  const p = config.video.prompt ?? "";
  for (const part of ["TRANSCRIPT", "CLAIMS", "AUTHENTICITY"]) {
    assert(p.includes(part), `video prompt lacks ${part}`);
  }
});

check("an album of screenshots is read whole, not as its first picture", () => {
  assert(config.image.attachments?.mode === "all", "image.attachments.mode must be all");
  assert(
    (config.image.attachments?.maxAttachments ?? 1) >= 10,
    "a Telegram album holds up to 10 items",
  );
});

check("both run on an explicit provider and are enabled", () => {
  for (const cap of ["image", "video"] as const) {
    assert(config[cap].enabled === true, `${cap}.enabled`);
    assert(config[cap].models?.[0]?.provider === "google", `${cap} first model is google`);
  }
});

check("the installer refuses to run without a key and proves a describe", () => {
  assert(/GEMINI_API_KEY\|GOOGLE_API_KEY/.test(installer), "key gate missing");
  assert(installer.includes("infer image describe"), "no image smoke test");
  assert(installer.includes("config validate"), "no schema validation");
});

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall passed");
