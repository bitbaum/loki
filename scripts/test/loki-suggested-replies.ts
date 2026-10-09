/**
 * Suggested replies (chatkit's `quick_replies` block) on every Loki chat.
 * Run: npx tsx scripts/test/loki-suggested-replies.ts
 *
 * The model writes the replies at the end of its answer, so the one thing that
 * must never happen is the block travelling WITH the answer: into the stored
 * message (and from there into copy, save-to-memory, titles, previews and the
 * next turn's history), into a work-trail note, or into speech. Env-independent:
 * the model call and the seed are injected.
 */
import assert from "node:assert/strict";
import { REPLIES_INSTRUCTION } from "@bitbaum/chatkit";
import type { ModelTurn } from "../../src/lib/agent/llm";
import type { ToolRegistry } from "../../src/lib/agent/tools/registry";
import { runLokiTurn, type LokiTurnEvent } from "../../src/lib/agent/loop";
import { readReplies } from "../../src/lib/loki/replies";
import { plainTextForSpeech } from "../../src/lib/loki/speech-text";

const BLOCK = '\n\n```quick_replies\n["Yes, run it", "Show me the diff first", "Not now"]\n```';
const SEED = { facts: [], directives: [] };
const NO_TOOLS: ToolRegistry = {};

/** One scripted answer; records the system prompt each call was given. */
function model(text: string) {
  const systems: string[] = [];
  const fn = async (input: { messages: Array<{ role: string; content: string }> }) => {
    systems.push(input.messages.find((m) => m.role === "system")?.content ?? "");
    const turn: ModelTurn = { text, toolCalls: [], model: "stub", cutOff: null, usageTokens: 0 };
    return turn;
  };
  return { fn: fn as never, systems };
}

async function main() {
  // ── A chat turn asks for replies and gets them back APART from the text ────
  {
    const m = model(`The deploy is green.${BLOCK}`);
    const r = await runLokiTurn({
      userId: "u1",
      message: "is it deployed?",
      registry: NO_TOOLS,
      seed: SEED,
      callModel: m.fn,
      replies: true,
    });
    assert.ok(m.systems[0].includes(REPLIES_INSTRUCTION), "a chat turn asks for replies");
    assert.equal(r.text, "The deploy is green.", "the block never travels with the answer");
    assert.deepEqual(r.replies, ["Yes, run it", "Show me the diff first", "Not now"]);
  }

  // ── Off (MCP, voice, prompt runs): not asked for, and stripped if sent anyway
  {
    const m = model(`The deploy is green.${BLOCK}`);
    const r = await runLokiTurn({
      userId: "u1",
      message: "is it deployed?",
      registry: NO_TOOLS,
      seed: SEED,
      callModel: m.fn,
    });
    assert.ok(!m.systems[0].includes("quick_replies"), "a non-chat caller is not asked");
    assert.equal(r.text, "The deploy is green.", "an unasked-for block is still removed");
    assert.deepEqual(r.replies, [], "and its replies are not handed to a caller with no buttons");
  }

  // ── A gathering round's note never carries the block ───────────────────────
  {
    let call = 0;
    const fn = async (): Promise<ModelTurn> => {
      call++;
      return call === 1
        ? {
            text: `Looking at the runs first.${BLOCK}`,
            toolCalls: [{ id: "1", name: "probe", args: {} }],
            model: "stub",
            cutOff: null,
            usageTokens: 0,
          }
        : { text: "All runs passed.", toolCalls: [], model: "stub", cutOff: null, usageTokens: 0 };
    };
    const { z } = await import("zod");
    const { defineTool } = await import("../../src/lib/agent/tools/registry");
    const registry: ToolRegistry = {
      probe: defineTool({
        name: "probe",
        kind: "read",
        description: "stub",
        params: z.object({}),
        example: "TOOL: probe\nARGS: {}",
        handler: async () => ({ facts: [], note: "nothing new" }),
      }),
    };
    const events: LokiTurnEvent[] = [];
    const r = await runLokiTurn({
      userId: "u1",
      message: "how are the runs?",
      registry,
      seed: SEED,
      callModel: fn as never,
      replies: true,
      onEvent: (e) => events.push(e),
    });
    const notes = r.work.filter((w) => w.kind === "note");
    assert.equal(notes.length, 1);
    assert.doesNotMatch(JSON.stringify(notes), /quick_replies/, "a stored note has no block");
    assert.doesNotMatch(
      JSON.stringify(events.filter((e) => e.type === "note")),
      /quick_replies/,
      "a streamed note has no block",
    );
  }

  // ── Stored replies read back defensively ───────────────────────────────────
  assert.deepEqual(readReplies({ replies: ["Yes", 3, "", "No"] }), ["Yes", "No"]);
  assert.deepEqual(readReplies(null), []);
  assert.deepEqual(readReplies({ replies: "Yes" }), [], "only an array is replies");

  // ── Never spoken aloud ──────────────────────────────────────────────────────
  const spoken = plainTextForSpeech(`The deploy is green.${BLOCK}`);
  assert.equal(spoken, "The deploy is green.", "the block is neither read nor named as code");

  console.log("loki-suggested-replies: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
