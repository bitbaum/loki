import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectDossier } from "@/db/queries/project-dossier";
import { RUNNER_OFFLINE_THRESHOLD_MS } from "@/lib/constants/runner";
import { WEEK_MS } from "@/lib/constants/time";

async function main() {
  const output = await build({
    entryPoints: ["src/components/projects/ProjectDossierSections.tsx"],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    packages: "external",
    jsx: "automatic",
    plugins: [
      {
        name: "unrelated-ui",
        setup(b) {
          b.onResolve({ filter: /(?:GoalEditor|GoalProgressBar|DevLogList)$/ }, (args) => ({
            path: args.path,
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: `export function ${args.path.split("/").pop()}() { return null; }`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const module = {
    exports: {} as {
      NowSection: React.ComponentType<{
        dossier: ProjectDossier;
        showBrief: boolean;
        interactive: boolean;
      }>;
    },
  };
  vm.runInNewContext(output.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    process,
    console,
  });
  const now = Date.now();
  // Only fields the actual section reads: no database or mocked state logic.
  const dossier = {
    builtAtMs: now,
    detail: { attrs: {}, project: { name: "fixture" } },
    state: {
      sessionUpdatedAt: new Date(now - 2 * WEEK_MS),
      runtimeObservedAt: new Date(now),
      agentRunning: true,
      currentPromptLabel: "Improve navigation",
    },
    userProject: { devLog: [] },
    commits: [{ atMs: now - 60_000 }],
  } as unknown as ProjectDossier;
  const render = () =>
    renderToStaticMarkup(
      createElement(module.exports.NowSection, { dossier, showBrief: false, interactive: false }),
    );
  assert.match(
    render(),
    /Working on Improve navigation/,
    "fresh agent activity wins over an old handoff",
  );
  assert.doesNotMatch(render(), />Idle</);
  dossier.state!.runtimeObservedAt = new Date(now - RUNNER_OFFLINE_THRESHOLD_MS - 1);
  assert.doesNotMatch(
    render(),
    /Working on Improve navigation/,
    "expired runtime claims never report work",
  );
  assert.match(render(), /Nothing running/);
  assert.match(render(), /last change/);
  console.log("✓ current agent observation, expired runtime and newer repository activity");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
