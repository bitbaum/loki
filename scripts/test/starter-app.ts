// The kickoff's "nextjs-tailwind" starter and new-site.sh's scripts/site-template
// must be ONE app: bitbaum/fleet templates/app. This pins the parts Loki owns:
//   - src/lib/starter-app.generated.ts is exactly the directory, regenerated;
//   - the directory is pinned to a fleet commit (the copy is checked against
//     that commit in CI by scripts/templates/sync-starter.sh --check);
//   - what a kickoff seeds is that app, rendered, minus only the workflows that
//     register-site.sh adds with the site's CD;
//   - a hostile project name cannot break out of the starter's string literals.
// Run: npx tsx scripts/test/starter-app.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STARTER_MODULE, starterModuleSource } from "../templates/starter-files";
import { TEMPLATES } from "@/lib/project-templates";
import { STARTER_APP_FILES, STARTER_APP_SOURCE } from "@/lib/starter-app.generated";
import {
  renderStarterFile,
  starterSeedFiles,
  starterTitle,
  starterValues,
} from "@/lib/starter-app";

const ROOT = process.cwd();
let pass = 0;
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  pass++;
};

// 1. The generated module is the directory, byte for byte.
ok(
  readFileSync(join(ROOT, STARTER_MODULE), "utf8") === starterModuleSource(ROOT),
  `${STARTER_MODULE} is stale — run: npx tsx scripts/templates/generate-starter-files.ts (after sync-starter.sh)`,
);

// 2. Pinned to a real fleet commit, never a local working copy.
ok(
  /^[0-9a-f]{40}$/.test(STARTER_APP_SOURCE),
  `scripts/site-template/.fleet-source must pin a fleet commit, got "${STARTER_APP_SOURCE}" — run scripts/templates/sync-starter.sh`,
);

// 3. It is the full starter: accounts, languages, security, lockfile, CI.
for (const path of [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "proxy.ts",
  "lib/security.ts",
  "lib/auth/server.ts",
  "i18n/routing.ts",
  "messages/de.json",
  "app/api/health/route.ts",
  ".env.example",
  "AGENTS.md",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml",
]) {
  ok(path in STARTER_APP_FILES, `the starter carries ${path}`);
}

// 4. The kickoff seeds that app, minus the workflows, with .gitignore named.
const seed = starterSeedFiles();
const nextjs = TEMPLATES["nextjs-tailwind"];
ok(
  nextjs.files === nextjs.files && Object.keys(nextjs.files).length === Object.keys(seed).length,
  "kickoff seeds the starter's file map",
);
ok(
  !Object.keys(seed).some((p) => p.startsWith(".github/workflows/")),
  "workflows are left to register-site.sh",
);
ok(".github/dependabot.yml" in seed, "non-workflow .github files are seeded");
ok(".gitignore" in seed && !("gitignore" in seed), "gitignore is seeded as .gitignore");
const expected = Object.keys(STARTER_APP_FILES).filter(
  (p) => !p.startsWith(".github/workflows/"),
).length;
ok(Object.keys(seed).length === expected, "nothing else is dropped or added");

// 5. Rendering fills every placeholder, and a hostile name cannot escape.
const values = starterValues({
  name: 'Zoë\'s "Bäckerei" `x` ${y} <b>|&',
  owner: "bitbaum",
  repo: "zoes",
});
ok(!/["\\`$<>|&]/.test(values.title), `title is sanitised: ${values.title}`);
ok(
  values.title.includes("Zoë") && values.title.includes("Bäckerei"),
  "title keeps the person's words",
);
ok(/^[a-z0-9-]+$/.test(values.slug), `slug is DNS-safe: ${values.slug}`);
ok(values.host === `${values.slug}.orangecat.ch`, "host is the slug on the sites domain");
for (const [path, body] of Object.entries(seed)) {
  const rendered = renderStarterFile(body, values);
  ok(!/__(SLUG|TITLE|HOST|WORKFLOW_OWNER)__/.test(rendered), `${path}: every placeholder filled`);
}
const site = renderStarterFile(seed["lib/site.ts"]!, values);
ok(
  site.includes(`slug: "${values.slug}"`) && site.includes(`title: "${values.title}"`),
  "lib/site.ts names the project",
);
const pkg = JSON.parse(renderStarterFile(seed["package.json"]!, values)) as {
  name: string;
  packageManager: string;
};
ok(pkg.name === values.slug, "package name is the slug");
ok(/^pnpm@11\.\d+\.\d+$/.test(pkg.packageManager), "pins pnpm 11");
ok(
  nextjs
    .render?.(seed["lib/site.ts"]!, {
      name: "Kaffee",
      description: "",
      owner: "bitbaum",
      repo: "kaffee",
    })
    ?.includes('slug: "kaffee"'),
  "the template renders through the starter renderer",
);

// 6. Titles.
ok(starterTitle("  a\u0000b  \n c ") === "ab c", "control characters and runs of space are folded");
ok(
  starterTitle('"$`') === "",
  "a title of only forbidden characters is empty (caller falls back to the slug)",
);

// 7. The kickoff's first task points at pnpm and the starter's own gate.
ok(
  /pnpm run verify/.test(nextjs.firstTask) && !/\bnpm (install|run|ci)\b/.test(nextjs.firstTask),
  "first task uses pnpm and verify",
);

console.log(`✓ starter-app: ${pass} checks passed`);
