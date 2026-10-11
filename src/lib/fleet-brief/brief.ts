/**
 * The fleet brief — the bitbaum studio's house rules, put in front of every
 * agent Loki dispatches to build or change a repo in the bitbaum org.
 *
 * WHY: the dispatch prompt carried the project's own profile (mission, stack,
 * goals) and nothing about the studio it belongs to. An agent briefed only on
 * the project writes what the project needs from scratch, so the studio grew
 * 17 hand-written health routes, 10 hand-rolled model calls, 9 private sets of
 * security headers, 6 language routers and 6 own-model settings — each a
 * duplicate of something bitbaum/fleet already lists as shared.
 *
 * WHAT IS TYPED HERE, AND WHAT IS NOT: the rules below (read fleet's docs,
 * start from its app template, the security bar, the finish rule) are Loki's
 * standing instruction and live in this file. The FACTS — which packages
 * exist and how to install them, which technology each job uses — are read
 * from bitbaum/fleet at dispatch time (./parse.ts says how), falling back to
 * `snapshot.generated.json`, which `pnpm run generate:fleet-brief` writes and
 * scripts/test/fleet-brief-snapshot-fresh.ts keeps from going stale.
 *
 * A dispatch never waits on GitHub for long and never fails because of it:
 * the fetch has a short timeout, results are cached in memory, a failure is
 * remembered briefly so a dead GitHub is not re-asked on every dispatch, and
 * every failure degrades to the snapshot.
 */
import { parseGithubRepo } from "@/lib/github-repo-ref";
import {
  FleetSnapshot,
  LIMITS,
  parsePackagesRegister,
  parseStackTable,
  type FleetPackage,
  type FleetStackRow,
} from "./parse";
import snapshotJson from "./snapshot.generated.json";

/** The repo that produces the facts. Its owner is the org the brief applies to. */
export const FLEET_REPO = { owner: "bitbaum", repo: "fleet", branch: "main" } as const;

const RAW_BASE = `https://raw.githubusercontent.com/${FLEET_REPO.owner}/${FLEET_REPO.repo}/${FLEET_REPO.branch}`;
export const FLEET_SOURCES = {
  packages: `${RAW_BASE}/registers/packages.json`,
  stack: `${RAW_BASE}/STACK.md`,
} as const;

/**
 * The heading the brief opens with and the line it ends on. activity-status.ts
 * strips everything between them from the Activity feed, and the end line is
 * what lets it do that without swallowing an unheaded task that follows.
 */
export const FLEET_BRIEF_HEADING = "## bitbaum house rules (direct operator instruction)";
export const FLEET_BRIEF_END = "End of bitbaum house rules.";

const FETCH_TIMEOUT_MS = 2_000;
const CACHE_TTL_MS = 15 * 60_000;
/** After a failed fetch, serve the snapshot this long before asking GitHub again. */
const FAILURE_TTL_MS = 2 * 60_000;
/** The rendered brief can never exceed this, whatever the register grows to. */
const MAX_BRIEF_CHARS = 5_000;

export type FleetFacts = {
  packages: FleetPackage[];
  stack: FleetStackRow[];
  /** Where each half came from this time — live from fleet, or the committed snapshot. */
  source: { packages: "live" | "snapshot"; stack: "live" | "snapshot" };
  /** When the package register was generated in fleet (null when it did not say). */
  registerGeneratedAt: string | null;
};

/** The committed fallback, validated like anything else that reaches a prompt. */
export function loadSnapshot(raw: unknown = snapshotJson): FleetSnapshot {
  return FleetSnapshot.parse(raw);
}

function snapshotFacts(): FleetFacts {
  const snap = loadSnapshot();
  return {
    packages: snap.packages,
    stack: snap.stack,
    source: { packages: "snapshot", stack: "snapshot" },
    registerGeneratedAt: snap.registerGeneratedAt,
  };
}

/** True when the repo is in the fleet's org — the only repos these rules govern. */
export function isFleetOrgRepo(gitUrl: string | null | undefined): boolean {
  const ref = parseGithubRepo(gitUrl);
  return ref !== null && ref.owner.toLowerCase() === FLEET_REPO.owner;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function fetchText(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Race the whole read, not just the headers: a body that trickles must
    // not hold a dispatch hostage any more than a server that never answers.
    return await Promise.race([
      (async () => {
        const res = await fetchImpl(url, {
          signal: controller.signal,
          cache: "no-store",
          redirect: "error",
          headers: { Accept: "text/plain, application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const declared = Number(res.headers.get("content-length") ?? "0");
        if (declared > LIMITS.bodyBytes) throw new Error("body too large");
        const text = await res.text();
        if (text.length > LIMITS.bodyBytes) throw new Error("body too large");
        return text;
      })(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("timeout")), {
          once: true,
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Fetch both producers and merge with the snapshot half-by-half. Never throws. */
export async function loadFleetFacts(
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<FleetFacts & { ok: boolean }> {
  const fallback = snapshotFacts();
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const [packagesText, stackText] = await Promise.all([
    fetchText(FLEET_SOURCES.packages, fetchImpl, timeoutMs).catch(() => null),
    fetchText(FLEET_SOURCES.stack, fetchImpl, timeoutMs).catch(() => null),
  ]);
  let register: ReturnType<typeof parsePackagesRegister> = null;
  if (packagesText !== null) {
    try {
      register = parsePackagesRegister(JSON.parse(packagesText));
    } catch {
      register = null;
    }
  }
  const stack = stackText !== null ? parseStackTable(stackText) : null;
  return {
    packages: register?.packages ?? fallback.packages,
    stack: stack ?? fallback.stack,
    source: { packages: register ? "live" : "snapshot", stack: stack ? "live" : "snapshot" },
    registerGeneratedAt: register ? register.generatedAt : fallback.registerGeneratedAt,
    ok: register !== null && stack !== null,
  };
}

let cached: { facts: FleetFacts; expiresAt: number } | null = null;
let inflight: Promise<FleetFacts> | null = null;

/** For tests: forget the in-memory cache. */
export function resetFleetFactsCache(): void {
  cached = null;
  inflight = null;
}

/**
 * The current fleet facts: cached, fetched at most once at a time, the
 * snapshot whenever GitHub is slow or wrong. `LOKI_FLEET_BRIEF_FETCH=off`
 * pins the snapshot (offline dev, or if raw GitHub ever needs to be cut out).
 */
export async function getFleetFacts(
  opts: { fetchImpl?: FetchLike; timeoutMs?: number; now?: () => number } = {},
): Promise<FleetFacts> {
  const now = opts.now ?? Date.now;
  if (process.env.LOKI_FLEET_BRIEF_FETCH === "off") return snapshotFacts();
  if (cached && cached.expiresAt > now()) return cached.facts;
  if (inflight) return inflight;
  inflight = loadFleetFacts(opts)
    .then(({ ok, ...facts }) => {
      cached = { facts, expiresAt: now() + (ok ? CACHE_TTL_MS : FAILURE_TTL_MS) };
      return facts;
    })
    .catch(() => snapshotFacts())
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The brief itself, from facts. Pure — the tests drive it directly. */
export function renderFleetBrief(facts: FleetFacts): string {
  const fleetUrl = `https://github.com/${FLEET_REPO.owner}/${FLEET_REPO.repo}`;
  const rules = [
    FLEET_BRIEF_HEADING,
    `This repository is in the ${FLEET_REPO.owner} org, so the studio's standing rules apply on top of the task.`,
    `- Before building, read ${FLEET_REPO.owner}/${FLEET_REPO.repo} AGENTS.md, STACK.md and SHARED.md (${fleetUrl}). Each fact there has one producer: point at it, never copy it into this repo.`,
    `- A NEW product starts from the fleet app template (${FLEET_REPO.owner}/${FLEET_REPO.repo} templates/app), not from a blank scaffold.`,
    "- Before writing a health route, model call, security headers, language routing, auth, mail, rate limiting, chat or date input of your own, check the shared packages below and SHARED.md. If one does the job, use it.",
    "- Security bar: never weaken CSP or other security headers, anonymisation, or sealed secrets. No vendor AI SDK and no hand-rolled model fetch: every model call goes through @bitbaum/ai-kit. No new auth package (STACK.md → Identity).",
    "- Done means merged, deployed and checked live on the running site. An open PR, a green CI or a merge alone is not done.",
  ];

  const stack = facts.stack.map((row) => `- ${row.job}: ${row.blessed}`);
  const packages = facts.packages.map((pkg) => {
    const purpose = pkg.purpose ? ` — ${pkg.purpose}` : "";
    const install = pkg.install ? ` (install: ${pkg.install})` : "";
    return `- ${pkg.name}${purpose}${install}`;
  });
  const asOf = facts.registerGeneratedAt
    ? `, register of ${facts.registerGeneratedAt.slice(0, 10)}`
    : "";

  const sections = [
    rules.join("\n"),
    `Blessed stack, one technology per job (from fleet STACK.md; a deviation is a human decision made in a fleet PR, exceptions are listed there):\n${stack.join("\n")}`,
    `Shared packages (from fleet registers/packages.json${asOf}; descriptions quoted from it):\n${packages.join("\n")}`,
  ];
  let brief = sections.join("\n\n");
  if (brief.length > MAX_BRIEF_CHARS) brief = `${brief.slice(0, MAX_BRIEF_CHARS - 1)}…`;
  return `${brief}\n${FLEET_BRIEF_END}`;
}

/**
 * The brief for a dispatch into `gitUrl`, or "" when the repo is not in the
 * fleet's org (a repo elsewhere is not governed by these rules, and an
 * unknown repo is not assumed to be ours). Never throws: the worst case is
 * the snapshot.
 */
export async function fleetBriefForRepo(
  gitUrl: string | null | undefined,
  opts: Parameters<typeof getFleetFacts>[0] = {},
): Promise<string> {
  if (!isFleetOrgRepo(gitUrl)) return "";
  try {
    return renderFleetBrief(await getFleetFacts(opts));
  } catch {
    try {
      return renderFleetBrief(snapshotFacts());
    } catch {
      return "";
    }
  }
}
