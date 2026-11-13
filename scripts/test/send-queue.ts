/**
 * The send queue belongs to a conversation and survives a reload
 * (hooks/use-send-queue), and a question left unanswered is found
 * (lib/loki/unanswered).
 *
 * Measured on production, 2026-11-13: three quick messages in a new chat
 * became three conversations; two queued messages vanished on reload; a
 * question whose answer died with the page showed nothing under it, forever.
 *
 * Run: npx tsx scripts/test/send-queue.ts
 */
import assert from "node:assert/strict";
import { readStoredQueue, storableQueue, takeFor, type Queued } from "@/hooks/use-send-queue";
import { unansweredTurn } from "@/lib/loki/unanswered";

type Item = { text: string; attachments?: unknown[] };
const q = (
  id: number,
  conversationId: string,
  text: string,
  attachments: unknown[] = [],
): Queued<Item> => ({
  id,
  conversationId,
  text,
  attachments,
});

// ── a queued message goes to the conversation it was typed in ───────────────
{
  const items = [q(1, "a", "A1"), q(2, "b", "B1"), q(3, "a", "A2")];
  const first = takeFor(items, "a");
  assert.equal(first.next?.text, "A1", "the oldest message of THIS conversation");
  assert.deepEqual(
    first.rest.map((x) => x.text),
    ["B1", "A2"],
  );
  assert.equal(takeFor(first.rest, "a").next?.text, "A2");
  assert.equal(takeFor(items, "c").next, null, "another conversation has nothing waiting");
  assert.equal(takeFor(items, "c").rest, items, "and the queue is untouched");
}

// ── what a reload keeps ─────────────────────────────────────────────────────
{
  const items = [q(1, "a", "words"), q(2, "a", "with a file", [{ name: "x.pdf" }])];
  const stored = storableQueue(items);
  assert.deepEqual(
    stored.map((x) => x.text),
    ["words"],
    "a message carrying files is not written down",
  );
  const back = readStoredQueue<Item>(JSON.stringify(stored));
  assert.deepEqual(back, stored, "what was stored comes back");
  assert.deepEqual(readStoredQueue<Item>(null), []);
  assert.deepEqual(readStoredQueue<Item>("not json"), []);
  assert.deepEqual(readStoredQueue<Item>('{"a":1}'), []);
  assert.deepEqual(
    readStoredQueue<Item>(
      JSON.stringify([{ id: "x", conversationId: "a", text: "t" }, { id: 1, text: "t" }, null]),
    ),
    [],
    "a row without a numeric id, a conversation or text is dropped",
  );
}

// ── a question nobody is answering ──────────────────────────────────────────
{
  const idle = { sending: false, loading: false, queued: 0 };
  const user = { id: "m1", role: "user", content: " How do tides work? " };
  const answer = { id: "m2", role: "assistant", content: "The moon." };
  assert.deepEqual(unansweredTurn([user], idle), { id: "m1", text: "How do tides work?" });
  assert.equal(unansweredTurn([user, answer], idle), null, "an answered question is not lost");
  assert.equal(unansweredTurn([], idle), null);
  assert.equal(unansweredTurn([user], { ...idle, sending: true }), null, "an answer is on its way");
  assert.equal(
    unansweredTurn([user], { ...idle, loading: true }),
    null,
    "the thread is still loading",
  );
  assert.equal(
    unansweredTurn([{ ...user, id: "pending-17" }], idle),
    null,
    "the optimistic bubble of a send in flight is not a lost question",
  );
  assert.equal(unansweredTurn([{ ...user, content: "  " }], idle), null);
}

console.log("send-queue: ok");
