/**
 * /loki keeps the open conversation in the URL (?c=), so Back returns to it.
 * Feedback b8a97aef (2026-09-18): dispatch from /loki, navigate back, and the
 * thread was gone from the pane while its follow-up chips still showed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conversationIdFromParam } from "../../src/lib/loki/conversation-param";

const id = "b8a97aef-1111-4222-8333-444455556666";
assert.equal(conversationIdFromParam(id), id);
assert.equal(conversationIdFromParam(` ${id} `), id);
assert.equal(conversationIdFromParam(null), null);
assert.equal(conversationIdFromParam(""), null);
assert.equal(conversationIdFromParam("../etc"), null);

const src = readFileSync("src/components/loki/LokiWorkspace.tsx", "utf8");
assert.match(
  src,
  /conversationIdFromParam\(searchParams\.get\("c"\)\)/,
  "activeId must seed from ?c=",
);
assert.match(src, /params\.set\("c", activeId\)/, "the open thread must be written to ?c=");

console.log("loki-conversation-in-url: ok");
