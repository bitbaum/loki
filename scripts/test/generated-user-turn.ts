import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { summaryPrompt, SUMMARY_REQUEST } from "@/lib/terminal-summary";
import { userMessageDisplay } from "@/lib/loki/message-display";

async function main() {
  const source = readFileSync("src/app/api/conversations/[id]/messages/route.ts", "utf8");
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "persistUserTurn",
  );
  assert.ok(node);
  // Execute the actual persistence function; only database/image storage and
  // title writes are replaced. The route still owns its auth/body boundary.
  const code = ts.transpileModule(node.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const writes: { content: string; meta: Record<string, unknown> }[] = [];
  const titles: string[] = [];
  const context = {
    addMessage: async (_id: string, message: { content: string; meta: Record<string, unknown> }) =>
      writes.push(message),
    saveConversationImages: async (_user: string, _thread: string, images: unknown[]) =>
      images.length ? ["image-id"] : [],
    conversationImagePath: () => "/saved-image",
    attachmentNoteLabel: () => "\n[terminal-screen.txt]",
    deriveConversationTitle: (text: string) => text,
    updateConversationTitle: async (_user: string, _id: string, title: string) =>
      titles.push(title),
    DEFAULT_CONVERSATION_TITLE: "New conversation",
  };
  const persist = vm.runInNewContext(code + "\npersistUserTurn;", context);
  const prompt = summaryPrompt("loki", "claude");
  await persist(
    "owner",
    "thread",
    { conversation: { title: "New conversation" }, messages: [] },
    prompt,
    [{ kind: "image", name: "screen.jpg" }],
    SUMMARY_REQUEST,
  );
  assert.equal(
    writes[0].content,
    prompt + "\n[terminal-screen.txt]",
    "the full request remains saved for model history and inspection",
  );
  assert.equal(writes[0].meta.displayText, SUMMARY_REQUEST);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].meta.images)), [
    { src: "/saved-image", caption: "screen.jpg" },
  ]);
  assert.deepEqual(
    titles,
    [SUMMARY_REQUEST],
    "the generated instructions do not become the thread title",
  );
  assert.equal(userMessageDisplay(writes[0].content, writes[0].meta), SUMMARY_REQUEST);
  assert.equal(
    userMessageDisplay(prompt, null),
    SUMMARY_REQUEST,
    "old saved terminal summaries also collapse",
  );
  const ordinary = "What's going on with loki? I wrote this myself.";
  assert.equal(userMessageDisplay(ordinary, null), ordinary);
  assert.equal(userMessageDisplay("ordinary", { displayText: "" }), "ordinary");
  assert.equal(userMessageDisplay("ordinary", { displayText: "x".repeat(241) }), "ordinary");
  await persist(
    "owner",
    "thread",
    { conversation: { title: "My own title" }, messages: [{}] },
    "ordinary",
    [],
  );
  assert.equal(writes[1].meta.displayText, undefined);
  assert.deepEqual(titles, [SUMMARY_REQUEST], "existing titles are preserved");
  const coreSource = readFileSync("src/lib/loki-core.ts", "utf8");
  const coreAst = ts.createSourceFile("core.ts", coreSource, ts.ScriptTarget.Latest, true);
  const loadNode = coreAst.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "loadOwnModel",
  );
  assert.ok(loadNode);
  const loadCode = ts.transpileModule(loadNode.getText(coreAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const load = vm.runInNewContext(loadCode + "\nloadOwnModel;", {
    getOwnModels: async () => [{ vendor: "xai", model: "grok" }],
    CHAT_CHAIN: [{ id: "groq", models: ["gpt-oss"] }],
    providerModels: (p: { models: string[] }) => p.models,
    ownModelFrom: () => ({ vendor: "xai" }),
    routeTurn: async () => null,
    console,
  });
  assert.equal(
    await load("owner", "gpt-oss", "question", []),
    null,
    "a shared selection cannot bill the unrelated own key",
  );
  assert.equal(await load("owner", "groq/gpt-oss", "question", []), null);
  assert.equal((await load("owner", "grok", "question", [])).vendor, "xai");
  assert.equal(
    (await load("owner", undefined, "question", [])).vendor,
    "xai",
    "Auto still starts on own keys",
  );
  assert.equal(
    (await load("owner", "unknown", "question", [])).vendor,
    "xai",
    "unknown ids do not opt into the shared pool",
  );
  console.log(
    "✓ saved labels, full instructions, images, legacy display and explicit shared routing",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
