import {
  PROVIDERS,
  authOf,
  maskSecrets,
  nextActionFor,
  sanitizeInventory,
  usableAgents,
  type ProviderInventoryEntry,
} from "../../src/lib/agents/provider-inventory";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures += 1;
}

const ids = PROVIDERS.map((p) => p.id);
for (const id of [
  "claude",
  "codex",
  "cursor",
  "grok",
  "gemini",
  "opencode",
  "qwen-code",
  "kimi",
  "openrouter",
]) {
  check(`registry has ${id}`, ids.includes(id));
}
check("registry ids are unique", new Set(ids).size === ids.length);

const spec = (id: string) => PROVIDERS.find((p) => p.id === id)!;
check(
  "auth by key names the env, never the value",
  authOf(spec("grok"), { XAI_API_KEY: "xai-secret" }, "/nonexistent").via === "XAI_API_KEY",
);
check("no key, no login → none", authOf(spec("grok"), {}, "/nonexistent").auth === "none");

const base = { installed: true, auth: "key" as const, probe: null, healthy: false };
check(
  "cloud missing key says which key and where",
  nextActionFor(spec("grok"), { ...base, auth: "none" }, "cloud")!.includes("XAI_API_KEY"),
);
check(
  "not installed says how to install",
  nextActionFor(spec("gemini"), { ...base, installed: false }, "cloud")!.startsWith("install:"),
);
check(
  "healthy has no next action",
  nextActionFor(
    spec("gemini"),
    { ...base, probe: { ok: true, at: "", detail: "PONG" }, healthy: true },
    "cloud",
  ) === null,
);

const row = (id: string, over: Partial<ProviderInventoryEntry>): ProviderInventoryEntry => ({
  id,
  label: id,
  kind: "cli",
  installed: true,
  path: "/x",
  version: "1",
  auth: "key",
  authVia: "K",
  probe: null,
  healthy: false,
  nextAction: null,
  ...over,
});
const usable = usableAgents([
  row("claude", { probe: { ok: false, at: "", detail: "usage limit reached" } }),
  row("cursor", { auth: "none" }),
  row("gemini", { probe: { ok: true, at: "", detail: "PONG" } }),
  row("grok", { probe: { ok: false, at: "", detail: "invalid api key" } }),
  row("codex", {}),
  row("openrouter", { kind: "gateway" }),
]);
check(
  "quota-walled agent stays a failover candidate (quota is per-run evidence)",
  usable.includes("claude"),
);
check("agent with no credential is not usable", !usable.includes("cursor"));
check("probed-ok agent is usable", usable.includes("gemini"));
check("agent whose probe failed for a non-quota reason is not usable", !usable.includes("grok"));
check(
  "unprobed-but-credentialed agent is usable (unknown is not broken)",
  usable.includes("codex"),
);
check("gateways are never failover agents", !usable.includes("openrouter"));

check(
  "maskSecrets hides token-shaped strings",
  !maskSecrets("key sk-or-v1-abcdefghijklmnopqrstuvwxyz123456 bad").includes("abcdefghijklmnop"),
);
const clean = sanitizeInventory([
  { id: "evil" },
  { ...row("gemini", {}), version: "v sk-abcdefghijklmnopqrstuvwxyz0123" },
]);
check("sanitize drops unknown ids", clean?.length === 1);
check("sanitize masks secrets in free text", !clean![0].version!.includes("abcdefghijklmnop"));

if (failures) {
  console.log(`${failures} PROVIDER INVENTORY TEST(S) FAILED`);
  process.exit(1);
}
