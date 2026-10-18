/**
 * Screenshots reach a terminal agent as image FILES (lib/agent-attachments).
 * Case from the report (2026-10-05): a screenshot attached in the Terminal's
 * composer reached the agent as "Could not analyze attached image(s): all
 * vision models failed — HTTP 429". The picture itself never left the browser.
 */
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  attachmentToken,
  parseAgentImages,
  resolveImageTokens,
  withImageTokens,
} from "@/lib/agent-attachments";
import { materializeImages } from "@/lib/agent-attachments-fs";
import { stageAttachmentsForAgent, stageForAgent } from "@/lib/composer-attachments";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

// A 1×1 transparent PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// The web side: images become placeholders and travel with the command.
const staged = stageAttachmentsForAgent("Why is this button cut off?", [
  { kind: "image", name: "screen.png", mimeType: "image/png", dataBase64: PNG },
  { kind: "text", name: "notes.txt", content: "only on the phone" },
]);
const img = staged.images[0];
check(
  "one image staged, with a uuid id",
  staged.images.length === 1 && /^[0-9a-f-]{36}$/.test(img?.id ?? ""),
);
check("the prompt names the image's placeholder", staged.prompt.includes(attachmentToken(img!.id)));
check(
  "the prompt tells the agent to open it",
  /open each image file and look at it/.test(staged.prompt),
);
check("text files are still inlined", staged.prompt.includes("only on the phone"));

// Loki's chat holds attachments already normalized; they stage the same way,
// so a screenshot sent in the chat reaches the agent as the image itself.
const fromChat = stageForAgent("The text is cramped", [
  { kind: "image", name: "phone.png", mimeType: "image/png", dataBase64: PNG },
]);
check(
  "a chat screenshot is staged as an image, not described",
  fromChat.images.length === 1 && fromChat.prompt.includes(attachmentToken(fromChat.images[0].id)),
);
check("no attachments → nothing staged", stageForAgent("hi", []).images.length === 0);
check("no vision call needed: the picture itself is carried", img?.dataBase64 === PNG);

// The runner side: the boundary check refuses anything malformed, whole.
check("absent attachments are fine", parseAgentImages(undefined).ok);
check("a well-formed image passes", parseAgentImages(staged.images).ok);
check("a non-uuid id is refused", !parseAgentImages([{ ...img, id: "../../etc/passwd" }]).ok);
check("a non-image type is refused", !parseAgentImages([{ ...img, mimeType: "text/html" }]).ok);
check("too many images are refused", !parseAgentImages(Array(6).fill(img)).ok);

// …writes the file where the agent runs and puts its absolute path in the prompt.
const dir = mkdtempSync(join(tmpdir(), "loki-att-"));
try {
  const typed = materializeImages(staged.prompt, staged.images, dir);
  const path = join(dir, `${img!.id}.png`);
  check(
    "the placeholder became the file's absolute path",
    typed.includes(path) && !typed.includes("{{loki-attachment:"),
  );
  check(
    "the file holds the exact image bytes",
    readFileSync(path).equals(Buffer.from(PNG, "base64")),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// A file that could not be written is said in words, never left as a token.
const orphan = resolveImageTokens(withImageTokens("look", [img!]), new Map());
check(
  "an undelivered screenshot is named, not a raw token",
  orphan.includes("could not be delivered") && !orphan.includes("{{"),
);
check("no images → the prompt is untouched", withImageTokens("look", []) === "look");

console.log(`\n${passed}/${passed} agent-attachments cases passed`);
