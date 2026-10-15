import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
async function main() {
  const source = fs.readFileSync("src/lib/inject-prompt.ts", "utf8");
  const parsed = ts.createSourceFile("inject.ts", source, ts.ScriptTarget.Latest, true);
  const fn = parsed.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.name?.text === "assembleInjectPrompt",
  )!;
  const js = ts.transpileModule(fn.getText(parsed).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const retrievals: string[] = [];
  const bindings = {
    getProjectContext: async () => "Project-specific goals",
    retrieveFleetContextBlock: async (_user: string, query: string) => {
      retrievals.push(query);
      return "Relevant project pattern";
    },
    getOpenEscalationBlock: async () => "",
    fleetBriefForProject: async () =>
      "## bitbaum house rules\nUse shared kit.\nEnd of bitbaum house rules.",
    FLEET_SESSIONS_DISPLAY_PATH: "~/.loki/sessions",
    exitContractFor: () => "Handoff contract",
    renderTaskForAdapter: (request: { customInstructions?: string; projectContext: string }) =>
      request.projectContext +
      "\n" +
      (request.customInstructions ?? "Choose a useful next project task."),
    isOrchestrationIntent: (key: string) => key === "next_best",
    getOrchestrationIntent: () => ({ name: "Next best" }),
    buildOperatorContextSection: () => {
      throw Error("Personal context must not be read");
    },
  };
  const assemble = new Function(...Object.keys(bindings), js + ";return assembleInjectPrompt;")(
    ...Object.values(bindings),
  );
  const base = {
    userId: "owner",
    projectKey: "petvity",
    projectPath: "/workspace/petvity",
    projectId: "entity",
    adapter: "claude",
  };
  const automatic = await assemble({ ...base, promptKey: "next_best" });
  assert(automatic.ok);
  assert.deepEqual(retrievals, [], "an intent key must not retrieve unrelated project documents");
  for (const body of [
    automatic.prompt,
    (await assemble({ ...base, customPrompt: "Fix mobile checkout" })).prompt,
  ]) {
    assert(body.includes("Project-specific goals"));
    assert(body.includes("Use shared kit"));
    assert(body.includes("Handoff contract"));
    assert(!body.includes("The operator's goals"));
  }
  assert.deepEqual(retrievals, ["Fix mobile checkout"]);
  for (const file of [
    "src/lib/inject-core.ts",
    "src/lib/inject-prompt.ts",
    "src/app/api/orchestration/run/route.ts",
  ]) {
    const tree = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        assert.notEqual(
          node.expression.text,
          "buildOperatorContextSection",
          `${file} must not inject personal life data`,
        );
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  const knowledgeFile = "src/db/queries/knowledge-embeddings.ts";
  const knowledgeTree = ts.createSourceFile(
    knowledgeFile,
    fs.readFileSync(knowledgeFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const retrieveFn = knowledgeTree.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.name?.text === "retrieveFleetContextBlock",
  )!;
  const retrieveJs = ts.transpileModule(retrieveFn.getText(knowledgeTree).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const retrieve = new Function(
    "embeddingsEnabled",
    "searchKnowledge",
    retrieveJs + ";return retrieveFleetContextBlock;",
  )(
    () => true,
    async (_actor: string, _query: string, opts: { sourceTypes: string[] }) => {
      assert.deepEqual(opts.sourceTypes, [
        "project_profile",
        "dev_log",
        "orchestration_outcome",
        "repo_doc",
      ]);
      return [
        { sourceType: "goal", sourceId: "private", chunk: "PRIVATE GOAL", metadata: {} },
        { sourceType: "commitment", sourceId: "private", chunk: "PRIVATE CONTACT", metadata: {} },
        {
          sourceType: "repo_doc",
          sourceId: "ours",
          chunk: "Same project",
          metadata: { project: "petvity" },
        },
        {
          sourceType: "repo_doc",
          sourceId: "other",
          chunk: "Checkout pattern",
          metadata: { project: "other" },
        },
      ];
    },
  );
  const retrieved = await retrieve("owner", "mobile checkout", { excludeProject: "petvity" });
  assert(retrieved.includes("Checkout pattern"));
  assert(!retrieved.includes("PRIVATE"));
  assert(!retrieved.includes("Same project"));
  console.log(
    "✓ coding dispatches retain project instructions and handoff; personal context stays out and generic intents skip cross-project retrieval",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
