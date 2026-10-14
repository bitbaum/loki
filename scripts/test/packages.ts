/**
 * Package management, phase 1: reading what a project is built from, and
 * saying whether it is behind.
 *
 * The fixtures are excerpts of real files — Loki's own package.json and
 * pnpm-lock.yaml (lockfile v9) as of 2026-10-14, fleet's registers/packages.json
 * — because the edge cases are in the shapes those files actually take: a git
 * tag that the lockfile resolves to a sha, a dependency pinned to a bare sha,
 * an npm alias, a package that lives inside another repository's monorepo.
 *
 * Needs no database and no network. Run: npx tsx scripts/test/packages.ts
 */
import assert from "node:assert/strict";
import { parseCatalogue, type CataloguePackage } from "../../src/lib/packages/catalogue-parse";
import {
  catalogueKey,
  matchCatalogue,
  observePackages,
  parseNpmLock,
  parsePnpmLock,
  parseSpec,
  resolveLockedVersion,
} from "../../src/lib/packages/manifest";
import {
  behindLabel,
  compareSemver,
  highestSemverTag,
  packageStatus,
  parseSemver,
  statusRank,
} from "../../src/lib/packages/status";
import { buildBuiltFrom, buildDependents, buildPackageList } from "../../src/lib/packages/view";
import { packagesAreStale, pickReadToken, PACKAGES_STALE_MS } from "../../src/lib/packages/rules";
import {
  getLatestVersions,
  npmLatestUrl,
  resetLatestVersionCache,
} from "../../src/lib/packages/latest";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** registers/packages.json, trimmed (fleet, generatedAt 2026-10-12). */
const REGISTER = {
  generatedAt: "2026-10-12T16:05:57.263Z",
  packages: [
    {
      slug: "ai-kit",
      name: "@bitbaum/ai-kit",
      repo: "https://github.com/bitbaum/ai-kit",
      description: null,
      version: "1.20.1",
      install: { source: "npm", command: "pnpm add @bitbaum/ai-kit" },
      adopters: 16,
      adopterNames: ["heidi", "loki", "orangecat"],
    },
    {
      slug: "accountkit",
      name: "@bitbaum/accountkit",
      repo: "https://github.com/bitbaum/accountkit",
      description: "One account for every bitbaum product: the account menu. And more.",
      version: "0.2.1",
      install: { source: "git", command: "pnpm add github:bitbaum/accountkit#v0.2.1" },
      adopterNames: ["loki"],
    },
    {
      slug: "chatkit",
      name: "@bitbaum/chatkit",
      repo: "https://github.com/bitbaum/chatkit",
      version: "0.7.0",
      install: {
        source: "git",
        command: "pnpm add github:bitbaum/chatkit#163c879163d22c6eb633314b3bd4e25712a01899",
      },
    },
    {
      slug: "ai-forms",
      name: "ai-forms",
      repo: "https://github.com/bitbaum/ai-forms",
      version: "0.1.3",
      install: { source: "npm", command: "pnpm add ai-forms" },
    },
    {
      slug: "listkit",
      name: "listkit",
      repo: "https://github.com/bitbaum/listkit",
      version: "0.2.0",
      install: { source: "git", command: "pnpm add github:bitbaum/listkit#v0.1.0" },
    },
    {
      // No slug — older registers did not carry one; it is derived.
      name: "@bitbaum/whenkit",
      repo: "https://github.com/bitbaum/whenkit",
      version: "0.3.2",
      install: { source: "git", command: "pnpm add github:bitbaum/whenkit#v0.3.2" },
    },
    { name: "Not A Valid Name!", repo: "x" },
  ],
};

/** Loki's package.json dependencies (excerpt). */
const PACKAGE_JSON = JSON.stringify({
  name: "loki",
  dependencies: {
    "@bitbaum/accountkit": "github:bitbaum/accountkit#v0.2.1",
    "@bitbaum/ai-kit": "^1.20.1",
    "@bitbaum/chatkit": "github:bitbaum/chatkit#b8b613d0c8984d7fdf902f3a8791fc9d84122b7f",
    "@bitbaum/searchkit":
      "github:bitbaum/orangecat#e6cda794af7eb8da0e88602bdce2c26283616498&path:packages/searchkit",
    "@bitbaum/whenkit": "github:bitbaum/whenkit#v0.3.2",
    "@fleet/ai-forms": "npm:ai-forms@^0.1.2",
    listkit: "github:bitbaum/listkit#v0.1.0",
    next: "16.3.8",
  },
  devDependencies: { "@bitbaum/design-tokens": "1.1.0" },
});

/** Loki's pnpm-lock.yaml (excerpt, lockfile v9). */
const PNPM_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      '@bitbaum/accountkit':
        specifier: github:bitbaum/accountkit#v0.2.1
        version: https://codeload.github.com/bitbaum/accountkit/tar.gz/ec5654270527757aa0e762f09b5aaabf272389a2(react@19.3.0)
      '@bitbaum/ai-kit':
        specifier: ^1.20.1
        version: 1.18.0(react@19.3.0)
      '@bitbaum/chatkit':
        specifier: github:bitbaum/chatkit#b8b613d0c8984d7fdf902f3a8791fc9d84122b7f
        version: https://codeload.github.com/bitbaum/chatkit/tar.gz/b8b613d0c8984d7fdf902f3a8791fc9d84122b7f(react@19.3.0)
      '@bitbaum/searchkit':
        specifier: github:bitbaum/orangecat#e6cda794af7eb8da0e88602bdce2c26283616498&path:packages/searchkit
        version: https://codeload.github.com/bitbaum/orangecat/tar.gz/e6cda794af7eb8da0e88602bdce2c26283616498#path:packages/searchkit(react@19.3.0)
      '@fleet/ai-forms':
        specifier: npm:ai-forms@^0.1.2
        version: ai-forms@0.1.2(react@19.3.0)
      listkit:
        specifier: github:bitbaum/listkit#v0.1.0
        version: https://codeload.github.com/bitbaum/listkit/tar.gz/69cb4f4ef12d6a2a56b56db1bb4d4ac14aced525
    devDependencies:
      '@bitbaum/design-tokens':
        specifier: 1.1.0
        version: 1.1.0

  packages/widget:
    dependencies:
      '@bitbaum/ai-kit':
        specifier: ^1.0.0
        version: 1.0.0

packages:

  '@bitbaum/accountkit@https://codeload.github.com/bitbaum/accountkit/tar.gz/ec5654270527757aa0e762f09b5aaabf272389a2':
    resolution: {gitHosted: true, tarball: https://codeload.github.com/bitbaum/accountkit/tar.gz/ec5654270527757aa0e762f09b5aaabf272389a2}
    version: 0.2.1
    engines: {node: '>=20'}

  '@bitbaum/ai-kit@1.18.0':
    resolution: {integrity: sha512-x}

  '@bitbaum/chatkit@https://codeload.github.com/bitbaum/chatkit/tar.gz/b8b613d0c8984d7fdf902f3a8791fc9d84122b7f':
    resolution: {gitHosted: true, tarball: https://codeload.github.com/bitbaum/chatkit/tar.gz/b8b613d0c8984d7fdf902f3a8791fc9d84122b7f}
    version: 0.7.0

  '@bitbaum/searchkit@https://codeload.github.com/bitbaum/orangecat/tar.gz/e6cda794af7eb8da0e88602bdce2c26283616498#path:packages/searchkit':
    resolution: {gitHosted: true, path: packages/searchkit}
    version: 0.2.2

  listkit@https://codeload.github.com/bitbaum/listkit/tar.gz/69cb4f4ef12d6a2a56b56db1bb4d4ac14aced525:
    resolution: {gitHosted: true}
    version: 0.1.0

snapshots:

  '@bitbaum/ai-kit@1.18.0(react@19.3.0)':
    dependencies:
      ai-forms: 0.1.2(react@19.3.0)
`;

const catalogue = parseCatalogue(REGISTER)!;
const byName = (name: string) => catalogue.find((p) => p.name === name)!;

async function main() {
  console.log("packages:");

  // ── the catalogue ─────────────────────────────────────────────────────────
  await check("the register parses into the catalogue, dropping invalid rows", () => {
    assert.equal(catalogue.length, 6);
    assert.deepEqual(
      catalogue.map((p) => p.slug),
      ["ai-kit", "accountkit", "chatkit", "ai-forms", "listkit", "whenkit"],
      "a missing slug is derived from the name",
    );
    const accountkit = byName("@bitbaum/accountkit");
    assert.equal(accountkit.repo, "bitbaum/accountkit");
    assert.equal(accountkit.installSource, "git");
    assert.equal(accountkit.summary, "One account for every bitbaum product: the account menu");
    assert.equal(accountkit.install, "pnpm add github:bitbaum/accountkit#v0.2.1");
    assert.equal(byName("@bitbaum/ai-kit").summary, null);
    assert.equal(parseCatalogue({ packages: [] }), null, "an empty register is not a register");
    assert.equal(parseCatalogue("nope"), null);
  });

  // ── specs ─────────────────────────────────────────────────────────────────
  await check("specs: npm range, npm alias, git tag, git sha, monorepo path, workspace", () => {
    assert.deepEqual(parseSpec("@bitbaum/ai-kit", "^1.20.1"), {
      kind: "npm",
      target: "@bitbaum/ai-kit",
      range: "^1.20.1",
    });
    assert.deepEqual(parseSpec("@fleet/ai-forms", "npm:ai-forms@^0.1.2"), {
      kind: "npm",
      target: "ai-forms",
      range: "^0.1.2",
    });
    assert.deepEqual(parseSpec("listkit", "github:bitbaum/listkit#v0.1.0"), {
      kind: "git",
      git: { owner: "bitbaum", repo: "listkit", ref: "v0.1.0", path: null },
    });
    assert.deepEqual(
      parseSpec(
        "@bitbaum/searchkit",
        "github:bitbaum/orangecat#e6cda794af7eb8da0e88602bdce2c26283616498&path:packages/searchkit",
      ),
      {
        kind: "git",
        git: {
          owner: "bitbaum",
          repo: "orangecat",
          ref: "e6cda794af7eb8da0e88602bdce2c26283616498",
          path: "packages/searchkit",
        },
      },
    );
    assert.deepEqual(parseSpec("x", "git+https://github.com/bitbaum/whenkit.git#semver:^0.3.0"), {
      kind: "git",
      git: { owner: "bitbaum", repo: "whenkit", ref: "^0.3.0", path: null },
    });
    assert.deepEqual(parseSpec("x", "git+ssh://git@github.com/bitbaum/chatkit.git#abc123"), {
      kind: "git",
      git: { owner: "bitbaum", repo: "chatkit", ref: "abc123", path: null },
    });
    assert.deepEqual(parseSpec("x", "bitbaum/listkit#v0.2.0").kind, "git", "GitHub shorthand");
    assert.deepEqual(parseSpec("x", "workspace:*"), { kind: "workspace" });
    assert.deepEqual(parseSpec("x", "file:vendor/x.tgz"), { kind: "local" });
    assert.equal(parseSpec("@scope/x", ">=1.0.0 <2").kind, "npm");
  });

  await check(
    "matching: by name, by alias target, by repository — never by a monorepo's repo",
    () => {
      const m = (dep: string, spec: string) =>
        matchCatalogue(dep, parseSpec(dep, spec), catalogue)?.name ?? null;
      assert.equal(m("@bitbaum/ai-kit", "^1.20.1"), "@bitbaum/ai-kit");
      assert.equal(m("@fleet/ai-forms", "npm:ai-forms@^0.1.2"), "ai-forms");
      assert.equal(
        m("lists", "github:bitbaum/listkit#v0.1.0"),
        "listkit",
        "repo match, any local name",
      );
      assert.equal(
        m("lists", "github:BitBaum/ListKit#v0.1.0"),
        "listkit",
        "repo match ignores case",
      );
      assert.equal(
        m("@bitbaum/searchkit", "github:bitbaum/orangecat#e6cd&path:packages/searchkit"),
        null,
        "searchkit is not in this register, and pointing into orangecat does not make it orangecat",
      );
      const withSearchkit: CataloguePackage[] = [
        ...catalogue,
        {
          ...byName("listkit"),
          slug: "searchkit",
          name: "@bitbaum/searchkit",
          repo: "bitbaum/searchkit",
        },
      ];
      assert.equal(
        matchCatalogue(
          "@bitbaum/searchkit",
          parseSpec("@bitbaum/searchkit", "github:bitbaum/orangecat#e6cd&path:packages/searchkit"),
          withSearchkit,
        )?.slug,
        "searchkit",
        "once registered under its own repo, the old monorepo spec still matches by name",
      );
      assert.equal(m("next", "16.3.8"), null);
    },
  );

  // ── lockfiles ─────────────────────────────────────────────────────────────
  await check("pnpm v9: the root importer only, peer suffixes stripped, git ids resolved", () => {
    const lock = parsePnpmLock(PNPM_LOCK)!;
    assert.ok(lock);
    assert.equal(
      resolveLockedVersion(lock, "@bitbaum/ai-kit"),
      "1.18.0",
      "root, not packages/widget",
    );
    assert.equal(
      resolveLockedVersion(lock, "@bitbaum/accountkit"),
      "0.2.1",
      "git tag via packages:",
    );
    assert.equal(resolveLockedVersion(lock, "@bitbaum/chatkit"), "0.7.0", "bare sha via packages:");
    assert.equal(resolveLockedVersion(lock, "@bitbaum/searchkit"), "0.2.2", "monorepo path id");
    assert.equal(resolveLockedVersion(lock, "@fleet/ai-forms"), "0.1.2", "npm alias");
    assert.equal(resolveLockedVersion(lock, "@bitbaum/design-tokens"), "1.1.0", "devDependencies");
    assert.equal(resolveLockedVersion(lock, "nope"), null);
    assert.equal(parsePnpmLock("not a lockfile"), null);
  });

  await check("pnpm v6 single project: top-level sections", () => {
    const lock = parsePnpmLock(`lockfileVersion: '6.0'

dependencies:
  limitkit:
    specifier: ^0.2.0
    version: 0.2.0
  shared:
    specifier: workspace:*
    version: link:../shared

devDependencies:
  '@bitbaum/design-tokens':
    specifier: ^1.0.0
    version: 1.0.4

packages:

  /limitkit@0.2.0:
    resolution: {integrity: sha512-x}
`)!;
    assert.equal(resolveLockedVersion(lock, "limitkit"), "0.2.0");
    assert.equal(resolveLockedVersion(lock, "@bitbaum/design-tokens"), "1.0.4");
    assert.equal(resolveLockedVersion(lock, "shared"), null, "a workspace link has no version");
  });

  await check("npm package-lock.json v3", () => {
    const lock = parseNpmLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {
            dependencies: {
              "@fleet/ai-forms": "npm:ai-forms@^0.1.2",
              listkit: "github:bitbaum/listkit#v0.1.0",
            },
          },
          "node_modules/@fleet/ai-forms": { name: "ai-forms", version: "0.1.2" },
          "node_modules/listkit": {
            version: "0.1.0",
            resolved:
              "git+ssh://git@github.com/bitbaum/listkit.git#69cb4f4ef12d6a2a56b56db1bb4d4ac14aced525",
          },
          "node_modules/listkit/node_modules/x": { version: "9.9.9" },
        },
      }),
    )!;
    assert.equal(resolveLockedVersion(lock, "@fleet/ai-forms"), "0.1.2");
    assert.equal(resolveLockedVersion(lock, "listkit"), "0.1.0");
    assert.equal(
      resolveLockedVersion(lock, "x"),
      null,
      "nested installs are not direct dependencies",
    );
  });

  await check(
    "observePackages: one row per catalogue package, catalogue names, real versions",
    () => {
      const observed = observePackages(PACKAGE_JSON, parsePnpmLock(PNPM_LOCK), catalogue)!;
      assert.deepEqual(
        observed.map((o) => [o.packageName, o.version, o.source]),
        [
          ["@bitbaum/accountkit", "0.2.1", "git"],
          ["@bitbaum/ai-kit", "1.18.0", "npm"],
          ["@bitbaum/chatkit", "0.7.0", "git"],
          ["@bitbaum/whenkit", "0.3.2", "git"],
          ["ai-forms", "0.1.2", "npm"],
          ["listkit", "0.1.0", "git"],
        ],
      );
      assert.equal(
        observed.find((o) => o.packageName === "ai-forms")!.spec,
        "npm:ai-forms@^0.1.2",
        "the spec is kept as written",
      );
      // whenkit is not in the lock excerpt: the version-shaped tag stands in.
      const noLock = observePackages(PACKAGE_JSON, null, catalogue)!;
      assert.equal(noLock.find((o) => o.packageName === "@bitbaum/whenkit")!.version, "0.3.2");
      assert.equal(
        noLock.find((o) => o.packageName === "@bitbaum/chatkit")!.version,
        null,
        "a bare sha with no lockfile is unknown, not guessed",
      );
      assert.equal(noLock.find((o) => o.packageName === "@bitbaum/ai-kit")!.version, null);
      assert.equal(observePackages("{not json", null, catalogue), null);
    },
  );

  await check(
    "the catalogue key changes when fleet registers a package, not when it reorders",
    () => {
      const a = catalogueKey(catalogue);
      assert.equal(catalogueKey([...catalogue].reverse()), a);
      assert.notEqual(catalogueKey(catalogue.slice(1)), a);
    },
  );

  // ── status ────────────────────────────────────────────────────────────────
  await check("semver: v prefixes, pre-releases, 0.x", () => {
    assert.deepEqual(parseSemver("v0.3.2"), { major: 0, minor: 3, patch: 2, pre: [] });
    assert.equal(parseSemver("0.3"), null);
    assert.equal(parseSemver("b8b613d"), null);
    const cmp = (a: string, b: string) => compareSemver(parseSemver(a)!, parseSemver(b)!);
    assert.equal(cmp("1.0.0-rc.1", "1.0.0"), -1);
    assert.equal(
      cmp("1.0.0-rc.2", "1.0.0-rc.10"),
      -1,
      "numeric pre-release parts compare as numbers",
    );
    assert.equal(cmp("v0.10.0", "0.9.9"), 1);
    assert.equal(cmp("1.2.3+build.5", "1.2.3"), 0);
    assert.equal(
      highestSemverTag(["v0.1.0", "v0.10.0", "v0.9.1", "nightly", "v1.0.0-rc.1"]),
      "0.10.0",
    );
    assert.equal(highestSemverTag(["latest"]), null);
  });

  await check("status: latest, behind (and how far), unknown", () => {
    assert.deepEqual(packageStatus("1.20.1", "1.20.1"), { kind: "latest" });
    assert.deepEqual(
      packageStatus("v1.21.0", "1.20.1"),
      { kind: "latest" },
      "ahead counts as latest",
    );
    assert.deepEqual(packageStatus("1.18.0", "1.20.1"), {
      kind: "behind",
      part: "minor",
      steps: 2,
      breaking: false,
    });
    assert.deepEqual(packageStatus("0.1.0", "v0.2.0"), {
      kind: "behind",
      part: "minor",
      steps: 1,
      breaking: true,
    });
    assert.deepEqual(packageStatus("0.2.0", "0.2.3"), {
      kind: "behind",
      part: "patch",
      steps: 3,
      breaking: false,
    });
    assert.deepEqual(packageStatus("1.9.0", "2.0.0"), {
      kind: "behind",
      part: "major",
      steps: 1,
      breaking: true,
    });
    assert.deepEqual(packageStatus("1.0.0-rc.1", "1.0.0"), {
      kind: "behind",
      part: "pre-release",
      steps: 1,
      breaking: false,
    });
    assert.deepEqual(packageStatus(null, "1.0.0"), { kind: "unknown", reason: "no-version" });
    assert.deepEqual(packageStatus("1.0.0", null), { kind: "unknown", reason: "no-latest" });
    assert.equal(behindLabel(packageStatus("1.18.0", "1.20.1")), "2 minor versions behind");
    assert.equal(behindLabel(packageStatus("1.9.0", "2.0.0")), "1 major version behind");
    assert.equal(behindLabel(packageStatus(null, "1.0.0")), "Version unknown");
    assert.ok(
      statusRank(packageStatus("0.1.0", "0.2.0")) < statusRank(packageStatus("1.1.0", "1.2.0")),
    );
    assert.ok(
      statusRank(packageStatus(null, "1.0.0")) < statusRank(packageStatus("1.0.0", "1.0.0")),
    );
  });

  // ── views ─────────────────────────────────────────────────────────────────
  const at = new Date("2026-10-14T08:00:00Z");
  const use = (projectName: string, packageName: string, version: string | null) => ({
    projectId: `p-${projectName}`,
    entityProjectId: projectName === "orphan" ? null : `e-${projectName}`,
    projectName,
    packageName,
    spec: version ? `^${version}` : "github:bitbaum/x#abc",
    version,
    source: "npm" as const,
    observedAt: at,
  });
  const latest = new Map([
    ["@bitbaum/ai-kit", { version: "1.20.1", from: "npm" as const }],
    ["listkit", { version: "0.2.0", from: "github" as const }],
  ]);
  const uses = [
    use("loki", "@bitbaum/ai-kit", "1.20.1"),
    use("heidi", "@bitbaum/ai-kit", "1.18.0"),
    use("orphan", "@bitbaum/ai-kit", null),
    use("loki", "listkit", "0.1.0"),
  ];

  await check("the list: used by, on latest, behind, unknown — per package", () => {
    const rows = buildPackageList(catalogue, latest, uses);
    const ai = rows.find((r) => r.slug === "ai-kit")!;
    assert.deepEqual([ai.usedBy, ai.onLatest, ai.behind, ai.unknown], [3, 1, 1, 1]);
    const chat = rows.find((r) => r.slug === "chatkit")!;
    assert.deepEqual([chat.usedBy, chat.latest.from], [0, "none"]);
    assert.equal(rows.length, catalogue.length, "every catalogue package has a row, used or not");
  });

  await check("dependents: behind first, then unknown, then latest; a link for each", () => {
    const rows = buildDependents(
      uses.filter((u) => u.packageName === "@bitbaum/ai-kit"),
      latest.get("@bitbaum/ai-kit")!,
    );
    assert.deepEqual(
      rows.map((r) => [r.projectName, r.status.kind]),
      [
        ["heidi", "behind"],
        ["orphan", "unknown"],
        ["loki", "latest"],
      ],
    );
    assert.equal(rows[0]!.href, "/projects/e-heidi");
    assert.equal(
      rows[1]!.href,
      "/projects?project=orphan",
      "no entity id: found by name, not a dead link",
    );
  });

  await check("built from: each package links to its page, behind first", () => {
    const rows = buildBuiltFrom(
      uses.filter((u) => u.projectName === "loki"),
      catalogue,
      latest,
    );
    assert.deepEqual(
      rows.map((r) => [r.packageName, r.slug, r.status.kind]),
      [
        ["listkit", "listkit", "behind"],
        ["@bitbaum/ai-kit", "ai-kit", "latest"],
      ],
    );
  });

  // ── sync rules ────────────────────────────────────────────────────────────
  await check("read token: the org token only inside the org, only when allowed", () => {
    const base = { orgOwner: "bitbaum", orgToken: "ORG", userToken: "USER" };
    assert.equal(pickReadToken({ ...base, repoOwner: "bitbaum", orgAllowed: true }), "ORG");
    assert.equal(pickReadToken({ ...base, repoOwner: "BitBaum", orgAllowed: true }), "ORG");
    assert.equal(pickReadToken({ ...base, repoOwner: "bitbaum", orgAllowed: false }), "USER");
    assert.equal(pickReadToken({ ...base, repoOwner: "someone", orgAllowed: true }), "USER");
    assert.equal(
      pickReadToken({ ...base, repoOwner: "someone", orgAllowed: true, userToken: null }),
      null,
      "no token at all: read it as a public repository",
    );
  });

  await check("stale: never read, or the oldest read over six hours ago", () => {
    const now = at.getTime();
    const fresh = { scannedAt: new Date(now - 60_000) };
    const old = { scannedAt: new Date(now - PACKAGES_STALE_MS - 1) };
    assert.equal(packagesAreStale([], 0, now), false, "nothing to read is never stale");
    assert.equal(packagesAreStale([fresh], 2, now), true, "a repository never read");
    assert.equal(packagesAreStale([fresh, fresh], 2, now), false);
    assert.equal(packagesAreStale([fresh, old], 2, now), true);
  });

  // ── latest versions ───────────────────────────────────────────────────────
  await check(
    "latest: npm for npm packages, GitHub tags for git ones, the register when neither answers",
    async () => {
      resetLatestVersionCache();
      const calls: string[] = [];
      const fetchImpl = async (url: string) => {
        calls.push(url);
        if (url === npmLatestUrl("@bitbaum/ai-kit")) return Response.json({ version: "1.21.0" });
        if (url.includes("/repos/bitbaum/listkit/tags")) {
          return Response.json([{ name: "v0.1.0" }, { name: "v0.3.0" }, { name: "v0.4.0-rc.1" }]);
        }
        return new Response("nope", { status: 500 });
      };
      const pkgs = [byName("@bitbaum/ai-kit"), byName("listkit"), byName("ai-forms")];
      const out = await getLatestVersions(pkgs, { fetchImpl });
      assert.deepEqual(out.get("@bitbaum/ai-kit"), { version: "1.21.0", from: "npm" });
      assert.deepEqual(out.get("listkit"), { version: "0.3.0", from: "github" });
      assert.deepEqual(out.get("ai-forms"), { version: "0.1.3", from: "register" });
      assert.equal(
        npmLatestUrl("@bitbaum/ai-kit"),
        "https://registry.npmjs.org/@bitbaum%2Fai-kit/latest",
      );
      const before = calls.length;
      await getLatestVersions(pkgs.slice(0, 2), { fetchImpl });
      assert.equal(calls.length, before, "answers are cached");
    },
  );

  await check("latest: a slow registry never holds the page past its deadline", async () => {
    resetLatestVersionCache();
    const started = Date.now();
    const out = await getLatestVersions([byName("@bitbaum/ai-kit")], {
      deadlineMs: 50,
      fetchImpl: () => new Promise<Response>(() => {}),
    });
    assert.ok(Date.now() - started < 1_000);
    assert.deepEqual(out.get("@bitbaum/ai-kit"), { version: "1.20.1", from: "register" });
    resetLatestVersionCache();
  });

  if (failures > 0) {
    console.log(`\n${failures} failed`);
    process.exit(1);
  }
  console.log("\nall passed");
}

void main();
