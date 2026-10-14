/**
 * Reading a Dependabot pull request: which packages it updates, from which
 * version to which, and whether that is a breaking step.
 *
 * Pure — no network, no database. The shapes are the ones Dependabot writes
 * (and the fleet sweep reads, bitbaum/fleet scripts/ci/auto-merge-sweep.sh):
 *
 *   title  "chore(deps): bump @bitbaum/chatkit from 0.3.1 to 0.3.2"
 *          "Bump listkit from v0.1.0 to v0.2.0 in /desktop"
 *          "chore(deps): bump the bitbaum group across 1 directory with 2 updates"
 *   body   "Bumps [@bitbaum/chatkit](https://github.com/bitbaum/chatkit) from 0.3.1 to 0.3.2."
 *          "Updates `@bitbaum/ai-kit` from 1.20.1 to 1.21.0"   (one line per member of a group)
 *
 * A version may be wrapped in backticks (a git sha usually is) and may carry a
 * `v`. Breaking follows the sweep exactly — a different major, or a different
 * minor under 1.0 — so Loki and the sweep can never disagree about which
 * updates merge on their own. A version that is not semver (a bare sha) cannot
 * be judged, and unknown is never permission: it counts as breaking.
 */
import { parseSemver } from "./status";

/** One package a pull request updates. */
export type PackageBump = {
  /** The catalogue's name when it is a fleet package, else the dependency as Dependabot named it. */
  name: string;
  /** The dependency as Dependabot named it — what an `@dependabot` command must say. */
  dependency: string;
  from: string;
  to: string;
  breaking: boolean;
  /** A fleet package (in bitbaum/fleet's catalogue). */
  fleet: boolean;
};

/** What the pull request says, before it is matched to the catalogue. */
export type RawBump = { dependency: string; from: string; to: string };

const PREFIX = String.raw`^(?:[\w-]+(?:\([\w-]+\))?!?:\s*)?`;
/** `bump X from A to B` (an optional ` in /dir` or ` in the G group` after it). */
const TITLE_SINGLE = new RegExp(
  `${PREFIX}bump\\s+(\\S+)\\s+from\\s+(\\S+)\\s+to\\s+(\\S+?)(?:\\s+in\\s+.*)?$`,
  "i",
);
/** `bump the G group …` — the members are in the body. */
const TITLE_GROUP = new RegExp(`${PREFIX}bump\\s+the\\s+\\S+\\s+group\\b`, "i");
const BODY_SINGLE = /^Bumps\s+(?:\[([^\]]+)\]\([^)]*\)|(\S+))\s+from\s+(\S+)\s+to\s+(\S+)/gim;
const BODY_UPDATES = /^Updates\s+`([^`]+)`\s+from\s+(\S+)\s+to\s+(\S+)/gim;

/** Strip what Dependabot wraps a version in: backticks, a trailing full stop. */
function cleanVersion(raw: string): string {
  return raw
    .replace(/^`+|`+$/g, "")
    .replace(/[.,;:]+$/, "")
    .replace(/`+$/, "");
}

function push(out: RawBump[], dependency: string, from: string, to: string): void {
  const dep = dependency.trim();
  if (!dep || out.some((b) => b.dependency === dep)) return;
  out.push({ dependency: dep, from: cleanVersion(from), to: cleanVersion(to) });
}

/** Is this the title of a grouped update (members listed in the body)? */
export function isGroupedTitle(title: string): boolean {
  return TITLE_GROUP.test(title.trim());
}

/**
 * Every update a Dependabot pull request makes, in the order it lists them.
 * The body is the fuller source (a group names its members only there); the
 * title is the fallback for a body that was edited away.
 */
export function parseDependabotBumps(title: string, body: string | null | undefined): RawBump[] {
  const out: RawBump[] = [];
  const text = body ?? "";
  for (const m of text.matchAll(BODY_UPDATES)) push(out, m[1]!, m[2]!, m[3]!);
  if (out.length === 0) {
    for (const m of text.matchAll(BODY_SINGLE)) push(out, m[1] ?? m[2]!, m[3]!, m[4]!);
  }
  if (out.length === 0 && !isGroupedTitle(title)) {
    const m = TITLE_SINGLE.exec(title.trim());
    if (m) push(out, m[1]!, m[2]!, m[3]!);
  }
  return out;
}

/** Which part of the version a step changes, or null when either side is not semver. */
export function bumpPart(from: string, to: string): "major" | "minor" | "patch" | null {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return null;
  if (a.major !== b.major) return "major";
  if (a.minor !== b.minor) return "minor";
  return "patch";
}

/** A step a project's code may have to change for. Not semver → breaking (unknown). */
export function isBreakingBump(from: string, to: string): boolean {
  const part = bumpPart(from, to);
  if (part === null) return true;
  if (part === "major") return true;
  return part === "minor" && parseSemver(from)!.major === 0;
}

/**
 * The bumps, each matched to a fleet package where it is one.
 *
 * A dependency is a fleet package when its name is a catalogue name, or when
 * it is the key the project's package.json lists a catalogue package under
 * (`depNames`: key → catalogue name, from the project's last read) — an npm
 * alias or a git dependency is named by its key, not by the package.
 */
export function matchBumps(
  raw: readonly RawBump[],
  catalogueNames: ReadonlySet<string>,
  depNames: ReadonlyMap<string, string>,
): PackageBump[] {
  return raw.map((b) => {
    const name = catalogueNames.has(b.dependency) ? b.dependency : depNames.get(b.dependency);
    return {
      name: name ?? b.dependency,
      dependency: b.dependency,
      from: b.from,
      to: b.to,
      breaking: isBreakingBump(b.from, b.to),
      fleet: name !== undefined,
    };
  });
}

/** Does any update in the pull request need a person? */
export function anyBreaking(bumps: readonly Pick<PackageBump, "breaking">[]): boolean {
  return bumps.some((b) => b.breaking);
}

/**
 * The comments that tell Dependabot to stop proposing these versions. It
 * closes the pull request when nothing is left in it.
 *
 * A single-dependency pull request takes `ignore this <part> version`; a group
 * needs the dependency named, one command per comment. A step that is not
 * semver has no "part" to ignore, so the pull request is closed instead
 * (`@dependabot close` also stops it being opened again).
 */
export function ignoreCommands(
  bumps: readonly Pick<PackageBump, "dependency" | "from" | "to" | "fleet">[],
  grouped: boolean,
): string[] {
  const targets = grouped ? bumps.filter((b) => b.fleet) : bumps.slice(0, 1);
  const parts = targets.map((b) => ({ b, part: bumpPart(b.from, b.to) }));
  if (targets.length === 0 || parts.some((p) => p.part === null)) return ["@dependabot close"];
  if (!grouped) return [`@dependabot ignore this ${parts[0]!.part} version`];
  return parts.map(({ b, part }) => `@dependabot ignore ${b.dependency} ${part} version`);
}
