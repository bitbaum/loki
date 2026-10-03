// The instance operator's private reach — their OpenClaw agent, its memory of
// their Telegram/WhatsApp threads, and their personal session — must never be
// reachable from another account's chat. Loki is multi-user with open sign-up.
// Run: npx tsx scripts/test/operator-tools-stay-private.ts
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import {
  defineTool,
  readOnlyRegistry,
  withoutOperatorTools,
  type ToolRegistry,
} from "@/lib/agent/tools/registry";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const noop = async () => ({ facts: [] });
const registry: ToolRegistry = {
  find_people: defineTool({
    name: "find_people",
    kind: "read",
    description: "",
    params: z.object({}),
    example: "",
    handler: noop,
  }),
  ask_openclaw: defineTool({
    name: "ask_openclaw",
    kind: "read",
    operatorOnly: true,
    description: "",
    params: z.object({}),
    example: "",
    handler: noop,
  }),
  propose_action: defineTool({
    name: "propose_action",
    kind: "propose",
    description: "",
    params: z.object({}),
    example: "",
    handler: noop,
  }),
};

const scoped = withoutOperatorTools(registry);
ok(!("ask_openclaw" in scoped), "operator-only tool removed for everyone else");
ok("find_people" in scoped && "propose_action" in scoped, "ordinary tools kept");
ok(!("ask_openclaw" in readOnlyRegistry(scoped)), "read-only of the scoped set stays scoped");

// The real tool is marked — the filter is worth nothing if the flag is missing.
const handlers = read("src/lib/agent/tools/handlers.ts");
const openclawDef = handlers.slice(
  handlers.indexOf('name: "ask_openclaw"'),
  handlers.indexOf('name: "ask_openclaw"') + 300,
);
ok(/operatorOnly:\s*true/.test(openclawDef), "ask_openclaw is marked operatorOnly");

// The loop fails closed: only an explicit `operator === true` keeps the tool.
const loop = read("src/lib/agent/loop.ts");
ok(
  /input\.operator === true \? fullRegistry : withoutOperatorTools\(fullRegistry\)/.test(loop),
  "runLokiTurn drops operator tools unless operator === true",
);

// The gateway fallback is the operator's agent too, and is guarded by the
// account, resolved from the database — not by an option a caller could set.
const core = read("src/lib/loki-core.ts");
ok(
  /isGatewayConfigured\(\) && !opts\?\.readOnly && operator\)/.test(core),
  "gateway fallback requires operator",
);
ok(
  /const operator = await isOperatorTurn\(opts\?\.userId\)/.test(core),
  "operator resolved from the account",
);
ok(
  !/operator\?: boolean/.test(
    core.slice(
      core.indexOf("export type AskLokiOpts"),
      core.indexOf("export async function askLoki"),
    ),
  ),
  "AskLokiOpts cannot claim operator",
);

// The personal Telegram/WhatsApp session is the operator's alone.
const askRoute = read("src/app/api/loki/route.ts");
ok(
  /personalKey && \(await isSiteOperator\(userId\)/.test(askRoute),
  "personal session key gated to the operator",
);

console.log(`${pass}/${pass + fail} operator-tools-stay-private cases passed`);
if (fail > 0) process.exit(1);
