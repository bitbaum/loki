import {
  isRunnerStale,
  isUnused,
  providerPlainLine,
  providerTechnicalDetail,
  runnerName,
  stripAnsi,
  type ProviderFacts,
} from "../../src/lib/agents/provider-words";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures += 1;
}

const base: ProviderFacts = {
  kind: "cli",
  installed: true,
  auth: "login",
  probe: null,
  healthy: false,
  nextAction: null,
  version: null,
};
const JARGON = /env|\/opt|curl|install:|fix:|_API_KEY|runner/i;

check("cloud is Loki's computer", runnerName("cloud") === "Loki's computer");
check("local is your computer", runnerName("local") === "Your computer");

const missing = { ...base, installed: false, nextAction: "install: curl https://x | bash" };
check(
  "not installed → plain words",
  providerPlainLine(missing, "cloud") === "Not set up on Loki's computer",
);
check("not installed is folded away", isUnused(missing));
check(
  "not installed keeps the command as technical detail",
  providerTechnicalDetail(missing)!.includes("curl"),
);

const noKey: ProviderFacts = {
  ...base,
  kind: "gateway",
  auth: "none",
  nextAction: "add OPENROUTER_API_KEY to the cloud runner's env (/opt/loki/runner/.env)",
};
check("no key on cloud names no env var", !JARGON.test(providerPlainLine(noKey, "cloud")));
check("no key, never tried → folded away", isUnused(noKey));

const expired: ProviderFacts = {
  ...base,
  probe: { ok: false, at: "", detail: "Failed to authenticate: OAuth session expired" },
  nextAction: "fix: Failed to authenticate: OAuth session expired",
};
check(
  "expired login on local → sign in again",
  providerPlainLine(expired, "local").startsWith("Signed out"),
);
check("a broken provider stays listed", !isUnused(expired));

const badKey: ProviderFacts = {
  ...base,
  probe: { ok: false, at: "", detail: "\u001b[91m\u001b[1mError: \u001b[0mInvalid API Key" },
};
check("refused key → plain words", providerPlainLine(badKey, "cloud") === "Its key was refused");
check(
  "ANSI codes are stripped from the detail",
  providerTechnicalDetail(badKey) === "Error: Invalid API Key",
);
check("visible ␛ codes are stripped", stripAnsi("␛[91mError␛[0m") === "Error");

const crashed: ProviderFacts = {
  ...base,
  probe: { ok: false, at: "", detail: "/usr/bin/codex: Datei oder Verzeichnis nicht gefunden" },
};
check(
  "unknown failure → plain words",
  providerPlainLine(crashed, "cloud") === "Did not answer when Loki tried it",
);

check("quota wins", providerPlainLine({ ...base, quota: "codex" }, "cloud").startsWith("Used up"));
check(
  "working shows version",
  providerPlainLine({ ...base, healthy: true, version: "1.2" }, "cloud") ===
    "Working · version 1.2",
);
check(
  "no technical detail when healthy",
  providerTechnicalDetail({ ...base, healthy: true }) === null,
);

const now = Date.parse("2026-11-12T12:00:00Z");
check("2 minutes old is fresh", !isRunnerStale("2026-11-12T11:58:00Z", now));
check("a day old is stale", isRunnerStale("2026-11-11T12:00:00Z", now));

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
