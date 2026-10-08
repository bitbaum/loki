// The terminal names the agent that is RUNNING in a tab, not the one the
// project prefers — and the tab strip can open, rename and close sessions.
//
// Operator ask 2026-10-08: "can I not switch from cursor to claude easily with
// that dropdown? I don't think it works … no way to open another tab on the
// terminal? no way to close or rename the tab?"
// Run: npx tsx scripts/test/terminal-agent-truth.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import {
  activeAgentFor,
  parseTabAliases,
  withTabAlias,
} from "@/components/terminal/terminal-agent";
import { TerminalTabStrip } from "@/components/terminal/TerminalTabStrip";

let pass = 0;
let fail = 0;
function ok(cond: unknown, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}
const roster = ["claude", "codex", "cursor", "grok", "gemini"];

// The live CLI wins over the saved preference.
ok(
  activeAgentFor({
    liveAgents: ["cursor"],
    rosterIds: roster,
    pref: "claude",
    fallback: "codex",
  }) === "cursor",
  "cursor running in a claude-preferring project is reported as cursor",
);
// Nothing running: the preference answers, then the account default.
ok(
  activeAgentFor({ liveAgents: [], rosterIds: roster, pref: "claude", fallback: "codex" }) ===
    "claude",
  "no live agent falls back to the project preference",
);
ok(
  activeAgentFor({ liveAgents: [], rosterIds: roster, pref: null, fallback: "codex" }) === "codex",
  "no preference falls back to the account default",
);
// A CLI the roster does not list must not be reported as the active agent.
ok(
  activeAgentFor({ liveAgents: ["vim"], rosterIds: roster, pref: "grok", fallback: null }) ===
    "grok",
  "an unlisted live process is ignored",
);
ok(
  activeAgentFor({ liveAgents: [], rosterIds: [], pref: null, fallback: null }) === null,
  "nothing known is null, not a guess",
);

// Aliases: only strings survive, junk is dropped, never throws.
ok(Object.keys(parseTabAliases("not json")).length === 0, "bad JSON parses to no aliases");
ok(Object.keys(parseTabAliases("[1,2]")).length === 0, "an array is not an alias map");
ok(
  parseTabAliases('{"a":"Docs","b":3,"c":""}').a === "Docs" &&
    !("b" in parseTabAliases('{"a":"Docs","b":3,"c":""}')) &&
    !("c" in parseTabAliases('{"a":"Docs","b":3,"c":""}')),
  "non-string and empty aliases are dropped",
);
ok(withTabAlias({}, "t", "  Docs  ", "t").t === "Docs", "a name is trimmed and stored");
ok(!("t" in withTabAlias({ t: "Docs" }, "t", "", "t")), "an empty name clears the alias");
ok(!("t" in withTabAlias({ t: "Docs" }, "t", "t", "t")), "the original name clears the alias");
ok(withTabAlias({}, "t", "x".repeat(200), "t").t.length === 60, "a name is capped at 60");

// The strip renders new / close / rename affordances only when handed the verbs.
const noop = () => {};
const tabs = [{ id: "loki", label: "loki", badge: "cursor" }];
const withVerbs = renderToStaticMarkup(
  createElement(TerminalTabStrip, {
    tabs,
    activeId: "loki",
    onSelect: noop,
    onClose: noop,
    onNew: noop,
    onRename: noop,
  }),
);
ok(/aria-label="Close loki"/.test(withVerbs), "strip offers Close when given onClose");
ok(/aria-label="New terminal"/.test(withVerbs), "strip offers New when given onNew");
ok(/Rename/.test(withVerbs) || /Double-click/i.test(withVerbs), "strip says how to rename");
const bare = renderToStaticMarkup(
  createElement(TerminalTabStrip, { tabs, activeId: "loki", onSelect: noop }),
);
ok(!/Close loki/.test(bare) && !/New terminal/.test(bare), "without verbs the strip stays bare");

// Wiring: the surface uses the live agent and does not swallow a failed switch.
const read = (f: string) => readFileSync(join(process.cwd(), "src/components/terminal", f), "utf8");
const surface = read("TerminalSurface.tsx");
const actions = read("use-terminal-tab-actions.ts");
ok(/activeAgentFor\(/.test(surface), "TerminalSurface derives the agent from the live CLI");
ok(
  !/tabContext\?\.agentPref \?\? context\?\.agents\.defaultAgent/.test(surface),
  "the pref-first derivation is gone",
);
ok(/actionError/.test(surface), "a failed agent switch is surfaced, not swallowed");
ok(
  /\/api\/control\/close-tab/.test(actions) && /closeTab\(id\)/.test(surface),
  "closing a tab calls the close-tab route",
);

if (fail) {
  console.error(`terminal-agent-truth: ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`terminal-agent-truth: ${pass} passed`);
