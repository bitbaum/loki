/**
 * What a repository is built from: its `package.json` and lockfile, read for
 * the dependencies that are fleet packages.
 *
 * Pure — the GitHub reads and the database writes are in ./sync.ts. Kept apart
 * because the edge cases live here and deserve tests that need no network:
 *
 *   "@bitbaum/ai-kit": "^1.20.1"                       npm range
 *   "@fleet/ai-forms": "npm:ai-forms@^0.1.2"           npm alias → ai-forms
 *   "listkit": "github:bitbaum/listkit#v0.1.0"         git tag
 *   "@bitbaum/chatkit": "github:bitbaum/chatkit#b8b6…" git sha
 *   "@bitbaum/searchkit": "github:bitbaum/orangecat#e6cd…&path:packages/searchkit"
 *                                                      a package inside another repo
 *
 * A dependency belongs to a catalogue entry when its name (or its npm alias's
 * target) is the entry's name, or — for a git spec with no `path:` — when the
 * repository it points at is the entry's repository. With a `path:` the repo
 * is somebody else's monorepo, so only the name may match: pointing at
 * bitbaum/orangecat does not make a dependency OrangeCat.
 *
 * The resolved version comes from the lockfile: pnpm (v6–v9 `importers: '.'`,
 * or the older single-project top level) or npm's package-lock.json (v2/v3).
 * A git dependency resolves to a tarball URL there, and the version is the
 * one pnpm recorded for that tarball under `packages:`; failing that, a
 * version-shaped tag in the spec; failing that, unknown — never a guess.
 */
import type { CataloguePackage } from "./catalogue-parse";
import { parseSemver } from "./status";

export type PackageSource = "npm" | "git" | "workspace" | "unknown";

export type ObservedPackage = {
  /** The catalogue name, whatever the project imports it as. */
  packageName: string;
  /** The key package.json lists it under — how Dependabot names its updates. */
  depName: string;
  /** The spec as written in package.json. */
  spec: string;
  /** Resolved from the lockfile; null when it cannot be known. */
  version: string | null;
  source: PackageSource;
};

/** The parts of a git spec Loki needs. */
export type GitSpec = {
  owner: string;
  repo: string;
  /** Tag, branch or sha after `#`, without `semver:`. */
  ref: string | null;
  /** `path:` inside the repository (a package in a monorepo). */
  path: string | null;
};

export type ParsedSpec =
  | { kind: "npm"; target: string; range: string }
  | { kind: "git"; git: GitSpec }
  | { kind: "workspace" }
  | { kind: "local" };

const GIT_URL_RE =
  /^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:#(.*))?$/i;
const GIT_SCP_RE = /^(?:git\+ssh:\/\/)?git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#(.*))?$/i;
const GITHUB_SHORT_RE = /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#(.*))?$/i;

function gitRef(fragment: string | undefined): { ref: string | null; path: string | null } {
  if (!fragment) return { ref: null, path: null };
  let ref: string | null = null;
  let path: string | null = null;
  // pnpm writes `#<ref>&path:<dir>`; npm-style `#<ref>::path:<dir>` is accepted too.
  for (const part of fragment.split(/&|::/)) {
    if (!part) continue;
    if (part.startsWith("path:")) path = part.slice(5).replace(/^\/+|\/+$/g, "") || null;
    else if (part.startsWith("semver:")) ref = part.slice(7) || null;
    else ref = part;
  }
  return { ref, path };
}

/** Classify a dependency spec. `depName` is the key it is listed under. */
export function parseSpec(depName: string, rawSpec: string): ParsedSpec {
  const spec = rawSpec.trim();
  if (spec.startsWith("workspace:")) return { kind: "workspace" };
  if (/^(?:link|file|portal):/.test(spec)) return { kind: "local" };
  const alias = /^npm:((?:@[^/@\s]+\/)?[^@\s]+)(?:@(.*))?$/.exec(spec);
  if (alias) return { kind: "npm", target: alias[1], range: alias[2] ?? "*" };
  const git = GIT_URL_RE.exec(spec) ?? GIT_SCP_RE.exec(spec);
  if (git) return { kind: "git", git: { owner: git[1], repo: git[2], ...gitRef(git[3]) } };
  // `owner/repo#ref` is GitHub shorthand; a scoped npm name starts with `@` and
  // a range never contains a slash, so neither is mistaken for it.
  if (spec.startsWith("github:") || (/^[\w.-]+\/[\w.-]+/.test(spec) && !spec.startsWith("@"))) {
    const short = GITHUB_SHORT_RE.exec(spec);
    if (short) {
      return { kind: "git", git: { owner: short[1], repo: short[2], ...gitRef(short[3]) } };
    }
  }
  if (/^(?:https?|git|ssh|git\+\w+):/.test(spec)) return { kind: "local" };
  return { kind: "npm", target: depName, range: spec };
}

/** The catalogue entry a dependency belongs to, or null. */
export function matchCatalogue(
  depName: string,
  parsed: ParsedSpec,
  catalogue: readonly CataloguePackage[],
): CataloguePackage | null {
  const byName = (name: string) => catalogue.find((pkg) => pkg.name === name) ?? null;
  if (parsed.kind === "npm") return byName(parsed.target) ?? byName(depName);
  const named = byName(depName);
  if (named || parsed.kind !== "git" || parsed.git.path) return named;
  const repo = `${parsed.git.owner}/${parsed.git.repo}`.toLowerCase();
  return catalogue.find((pkg) => pkg.repo?.toLowerCase() === repo) ?? null;
}

// ── package.json ─────────────────────────────────────────────────────────────

const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/** Every declared dependency → its spec. The first section to name one wins. */
export function readManifestDependencies(packageJson: string): Map<string, string> | null {
  let json: unknown;
  try {
    json = JSON.parse(packageJson);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const deps = new Map<string, string>();
  for (const section of DEP_SECTIONS) {
    const block = (json as Record<string, unknown>)[section];
    if (!block || typeof block !== "object") continue;
    for (const [name, spec] of Object.entries(block as Record<string, unknown>)) {
      if (typeof spec === "string" && !deps.has(name)) deps.set(name, spec);
    }
  }
  return deps;
}

// ── lockfiles ────────────────────────────────────────────────────────────────

/** What a lockfile says about the root project's direct dependencies. */
export type LockInfo = {
  /** Dependency name → the version string the lockfile resolved it to (raw). */
  direct: Map<string, string>;
  /** Resolution id (the part after `name@` in a `packages:` key) → package version. */
  versionsById: Map<string, string>;
  kind: "pnpm" | "npm";
};

function unquoteYaml(raw: string): string {
  const v = raw.trim();
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** `name@id` → id; the name may be scoped (`@scope/name@id`). */
function splitPackageKey(key: string): { name: string; id: string } | null {
  const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  if (at <= 0) return null;
  return { name: key.slice(0, at), id: key.slice(at + 1) };
}

/**
 * The slice of `pnpm-lock.yaml` Loki reads, by indentation rather than a YAML
 * library: the lockfile's layout is generated and fixed, and the two blocks
 * needed are `importers: '.'` (or the top-level sections of a single-project
 * v6 file) and the `version:` lines under `packages:`.
 */
export function parsePnpmLock(text: string): LockInfo | null {
  const lines = text.split(/\r?\n/);
  if (!lines.some((l) => /^lockfileVersion:/.test(l))) return null;
  const direct = new Map<string, string>();
  const versionsById = new Map<string, string>();
  const hasImporters = lines.some((l) => l === "importers:");

  // Indentation of the dependency sections, the names under them, and their fields.
  const base = hasImporters ? 4 : 0;
  let block: "none" | "importers" | "root" | "packages" | "other" = "none";
  let inRootImporter = false;
  let inSection = false;
  let currentDep: string | null = null;
  let currentPkg: string | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();

    if (indent === 0) {
      currentDep = null;
      currentPkg = null;
      inSection = false;
      if (body === "importers:") block = "importers";
      else if (body === "packages:") block = "packages";
      else if (
        !hasImporters &&
        /^(dependencies|devDependencies|optionalDependencies):$/.test(body)
      ) {
        block = "root";
        inSection = true;
      } else block = "other";
      continue;
    }

    if (block === "packages") {
      if (indent === 2 && body.endsWith(":")) {
        currentPkg = unquoteYaml(body.slice(0, -1));
      } else if (indent === 4 && currentPkg && body.startsWith("version:")) {
        const key = splitPackageKey(currentPkg);
        if (key) versionsById.set(key.id, unquoteYaml(body.slice(8)));
      }
      continue;
    }

    if (block === "importers") {
      if (indent === 2) {
        inRootImporter = /^(?:\.|'\.'|"\.")\s*:$/.test(body);
        inSection = false;
        currentDep = null;
        continue;
      }
      if (!inRootImporter) continue;
      if (indent === 4) {
        inSection = /^(dependencies|devDependencies|optionalDependencies):$/.test(body);
        currentDep = null;
        continue;
      }
    }

    if (block !== "importers" && block !== "root") continue;
    if (!inSection) continue;
    if (indent === base + 2 && body.endsWith(":")) {
      currentDep = unquoteYaml(body.slice(0, -1));
    } else if (indent === base + 4 && currentDep && body.startsWith("version:")) {
      if (!direct.has(currentDep)) direct.set(currentDep, unquoteYaml(body.slice(8)));
    }
  }
  return { direct, versionsById, kind: "pnpm" };
}

/** `package-lock.json` (lockfileVersion 2 or 3). */
export function parseNpmLock(text: string): LockInfo | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const packages = (json as { packages?: unknown })?.packages;
  if (!packages || typeof packages !== "object") return null;
  const direct = new Map<string, string>();
  for (const [key, value] of Object.entries(packages as Record<string, unknown>)) {
    const m = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
    const version = (value as { version?: unknown })?.version;
    if (m && typeof version === "string") direct.set(m[1], version);
  }
  return { direct, versionsById: new Map(), kind: "npm" };
}

/** Strip pnpm's peer suffix: `1.20.1(react@19.3.0)` → `1.20.1`. */
function withoutPeers(raw: string): string {
  const paren = raw.indexOf("(");
  return (paren >= 0 ? raw.slice(0, paren) : raw).trim();
}

/** A version-shaped string, without a `v`, or null. */
function semverOrNull(raw: string | null | undefined): string | null {
  return parseSemver(raw) ? raw!.trim().replace(/^v/, "") : null;
}

/** The version a lockfile resolved one direct dependency to, or null. */
export function resolveLockedVersion(lock: LockInfo | null, depName: string): string | null {
  const raw = lock?.direct.get(depName);
  if (!raw) return null;
  if (lock!.kind === "npm") return semverOrNull(raw);
  const id = withoutPeers(raw);
  if (/^(?:link|file):/.test(id)) return null;
  // A git (or any URL) dependency: pnpm recorded the package's own version
  // under the same id in `packages:`.
  if (/^https?:\/\/|^git[+:]/.test(id) || id.includes("codeload.github.com")) {
    return semverOrNull(lock!.versionsById.get(id));
  }
  // An npm alias resolves to `<real name>@<version>`.
  const aliased = splitPackageKey(id);
  if (aliased && parseSemver(aliased.id)) return semverOrNull(aliased.id);
  return semverOrNull(id);
}

/**
 * The catalogue packages a project is built from, from its package.json and
 * (optionally) its lockfile. Sorted by name, one row per catalogue package.
 */
export function observePackages(
  packageJson: string,
  lock: LockInfo | null,
  catalogue: readonly CataloguePackage[],
): ObservedPackage[] | null {
  const deps = readManifestDependencies(packageJson);
  if (!deps) return null;
  const out = new Map<string, ObservedPackage>();
  for (const [depName, spec] of deps) {
    const parsed = parseSpec(depName, spec);
    const pkg = matchCatalogue(depName, parsed, catalogue);
    if (!pkg || out.has(pkg.name)) continue;
    const locked = resolveLockedVersion(lock, depName);
    let version = locked;
    if (!version && parsed.kind === "git") version = semverOrNull(parsed.git.ref);
    out.set(pkg.name, {
      packageName: pkg.name,
      depName,
      spec: spec.slice(0, 300),
      version,
      source:
        parsed.kind === "npm"
          ? "npm"
          : parsed.kind === "git"
            ? "git"
            : parsed.kind === "workspace"
              ? "workspace"
              : "unknown",
    });
  }
  return [...out.values()].sort((a, b) => a.packageName.localeCompare(b.packageName));
}

/**
 * A short fingerprint of what the catalogue matches on. Stored with each scan,
 * so a project whose head commit has not moved is still re-read when fleet
 * registers a package it might already use.
 */
export function catalogueKey(catalogue: readonly CataloguePackage[]): string {
  const text = catalogue
    .map((pkg) => `${pkg.name}|${pkg.repo ?? ""}`)
    .sort()
    .join("\n");
  // FNV-1a, 32-bit: a change detector, not a security boundary.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${catalogue.length}:${hash.toString(16).padStart(8, "0")}`;
}
