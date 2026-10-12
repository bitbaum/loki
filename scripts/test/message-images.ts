// Pictures sent in a Loki chat stay with the thread (src/lib/loki/message-images.ts).
//
// 2026-10-12: a screenshot sent to Loki reached the agent and then vanished —
// the message kept "[Attached: screenshot.png (image)]" and nothing else, so
// the thread lost the very thing it was about. These pin what a message may
// carry and what the bubble shows.
import assert from "node:assert/strict";
import {
  conversationImagePath,
  localMessageImages,
  readMessageImages,
} from "../../src/lib/loki/message-images";

const convo = "3f0c7a52-1111-4222-8333-944455556666";
const img = "9a1b2c3d-1111-4222-8333-944455556666";

// A stored picture round-trips through the message meta.
{
  const src = conversationImagePath(convo, img);
  assert.equal(src, `/api/conversations/${convo}/images/${img}`);
  assert.deepEqual(readMessageImages({ images: [{ src, caption: "bug.png" }] }), [
    { src, caption: "bug.png" },
  ]);
}

// While sending, the sender's own picked file shows straight away.
{
  const local = localMessageImages([
    { kind: "image", name: "bug.png", mimeType: "image/png", dataBase64: "AAAA" },
    { kind: "text", name: "notes.txt", content: "x" },
  ]);
  assert.deepEqual(local, [{ src: "data:image/png;base64,AAAA", caption: "bug.png" }]);
  assert.deepEqual(readMessageImages({ images: local }), local);
}

// Nothing else gets into an <img>: no foreign hosts, no scripts, no SVG.
{
  const bad = [
    { src: "https://evil.example/x.png", caption: "x" },
    { src: "javascript:alert(1)", caption: "x" },
    { src: "data:image/svg+xml;base64,PHN2Zz4=", caption: "x" },
    // Joined, not written as one literal: scripts/test/internal-paths-resolve.ts
    // reads path-shaped strings as links, and this one is deliberately broken.
    {
      src: ["", "api", "conversations", convo, "images", "..", "..", "users"].join("/"),
      caption: "x",
    },
    { src: 42, caption: "x" },
  ];
  assert.deepEqual(readMessageImages({ images: bad }), []);
  assert.deepEqual(readMessageImages(null), []);
  assert.deepEqual(readMessageImages({ images: "nope" }), []);
}

// At most five, like the composer allows.
{
  const many = Array.from({ length: 8 }, (_, i) => ({
    src: conversationImagePath(convo, img.replace(/^9/, String(i))),
    caption: `${i}`,
  }));
  assert.equal(readMessageImages({ images: many }).length, 5);
}

console.log("message-images: ok");
