/**
 * "Which model are you" is answered from the prompt, in one line.
 * Run: npx tsx scripts/test/model-identity.ts
 */
import assert from "node:assert/strict";
import { modelIdentityLine } from "@/lib/agent/model-identity";

const own = modelIdentityLine({ label: "Anthropic · claude-opus-5.5 (+2 more)" }, "ignored");
assert.match(own, /operator's own key: Anthropic · claude-opus-5\.5 \(\+2 more\)/);
assert.match(own, /Settings → AI/);

const pinned = modelIdentityLine(null, "openai/gpt-oss-120b");
assert.match(pinned, /pinned in the composer, openai\/gpt-oss-120b/);

const auto = modelIdentityLine(undefined, undefined);
assert.match(auto, /shared chain of free models/);
assert.match(auto, /footer names the model that actually replied/);

console.log("✓ model identity line tests passed");
