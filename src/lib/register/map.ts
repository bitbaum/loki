import type { RegisterRow } from "./build";
import { PUBLIC_IDENTITY_ATTRS, type PublicIdentityAttr } from "@/config/project-attrs";

/**
 * The fleet MAP: the register (what exists, where it runs, where the code is)
 * plus what each project is for and what is happening on it right now.
 *
 * Why a second shape and not more columns on the register: the register is
 * the join of facts other systems own (apps.conf, the profile, OrangeCat,
 * Solon) and it is consumed as such. The map is what a reader — a person on
 * bitbaum, the assistant answering "what do we have", Cat on OrangeCat — needs
 * to orient: one line of purpose, a layer, a state, and the last thing that
 * moved. Both come from the same rows, so they cannot disagree; the map only
 * adds the activity columns Loki alone can see (runs, dev log, goals).
 *
 * Pure. All I/O happens in the route; this is unit-tested without a database.
 */

export type MapLayer =
  // "capability" until 2026-09-20. Renamed with the pillar it names: Loki is
  // the EXECUTION layer, and "capability" described what it can do rather than
  // what it is for. See orangecat/src/config/ecosystem.ts → ECOSYSTEM_PILLARS.
  "economic" | "execution" | "governance" | "client" | "product" | "demo" | "next";

export type FleetMapEntry = {
  slug: string;
  name: string;
  /** One line: what the project IS. Null when nobody has written it yet. */
  what: string | null;
  stack: string | null;
  layer: MapLayer;
  /** "live" | "demo" | "prospect" | "retired" | … from apps.conf, or "not live". */
  status: string;
  /** Who it is for: "bitbaum" = ours; anything else is a client. */
  owner: string;
  since: string | null;
  urls: {
    live: string | null;
    repo: string | null;
    orangecat: string | null;
    solon: string | null;
  };
  /**
   * The six things a product owes a reader. These already existed in the
   * profile — attributes, `goals`, `dev_log` — and were injected into every
   * agent dispatch while being unreadable from outside the database, so a site
   * that wanted them had no choice but to type its own copy. Published here so
   * a page renders them instead of authoring them.
   */
  identity: MapIdentity;
  roadmap: MapRoadmapItem[];
  changelog: MapChangelogEntry[];
  /** The project's own declared next step, from its dev log. */
  next: string | null;
  now: {
    openRuns: number;
    lastRun: { outcome: string; at: string } | null;
    lastLog: { date: string; done: string } | null;
  };
};

export type FleetMap = {
  generatedAt: string;
  thesis: string;
  pillars: Array<{ slug: string; layer: MapLayer; role: string }>;
  summary: { projects: number; live: number; clients: number; inFlight: number };
  projects: FleetMapEntry[];
};

/** The three pillars: one thesis, three products, honest seams between them. */
export const PILLARS: ReadonlyArray<{ slug: string; layer: MapLayer; role: string }> = [
  {
    slug: "orangecat",
    layer: "economic",
    role: "Move value: identity, entities, Bitcoin settlement, the economy that remembers need.",
  },
  {
    slug: "loki",
    layer: "execution",
    role: "Get the work done: a captain over a fleet of agents, with verification and approval built in — and the people, commitments and spending the work runs on.",
  },
  {
    slug: "solon",
    layer: "governance",
    role: "Coordinate without a coercive state: signed voting, transparent treasury, rules people can recount.",
  },
];

export const THESIS =
  "One person plus Bitcoin, an AI fleet and cryptographic governance replaces the permission a corporation, bank, platform or state would otherwise grant.";

export type MapActivity = {
  openRuns: number;
  lastRun: { outcome: string; at: Date } | null;
};

export type MapProfile = {
  stack?: string | null;
  devLog?: Array<{ date: string; done?: string | null; next?: string | null }> | null;
  /** The four public identity attributes, already filtered to the allowlist. */
  identity?: Partial<Record<PublicIdentityAttr, string>> | null;
  /** Goal rows for this project, in whatever order the query returned them. */
  goals?: Array<{
    title: string;
    status?: string | null;
    progress?: number | null;
    targetDate?: string | null;
    milestones?: Array<{ title: string; done?: boolean }> | null;
  }> | null;
};

/**
 * What a project owes a reader. Four attributes, a roadmap and a changelog —
 * the same six everywhere, so a consumer never has to ask which surface calls
 * it what.
 *
 * Null means nobody has written it. An empty array means the project has the
 * surface and nothing on it yet. A consumer must render those differently:
 * "not written" invites someone to write it, "nothing yet" does not.
 */
export type MapIdentity = {
  problem: string | null;
  solution: string | null;
  mission: string | null;
  vision: string | null;
};

/** One step of a roadmap item, and whether it is done. */
export type MapMilestone = { title: string; done: boolean };

export type MapRoadmapItem = {
  title: string;
  status: string | null;
  progress: number | null;
  targetDate: string | null;
  milestones: MapMilestone[];
  /**
   * Where this item came from, when the goal records it — a spec or brief in
   * the repo. Its own field because it arrives INSIDE the milestone list
   * (`Source: https://…`) and it is not a step anyone can do.
   */
  source: string | null;
};

export type MapChangelogEntry = { date: string; done: string };

const OWN = new Set(["bitbaum", "-", ""]);

/**
 * A project's PUBLIC profile path — the only Loki URL about one project that
 * resolves for a reader with no account.
 *
 * One function because there was one hardcoded string too many. Every entry
 * Loki has ever published to an OrangeCat wall linked back to `/projects`,
 * which is the operator's private dashboard: a stranger following it lands on
 * a sign-in form, and the owner lands on all 36 projects rather than the one
 * the entry was about. The page it should have pointed at has existed the
 * whole time.
 */
export function publicProfilePath(slug: string): string {
  return `/fleet/${encodeURIComponent(slug)}`;
}

export function layerFor(row: RegisterRow): MapLayer {
  const pillar = PILLARS.find((p) => p.slug === row.slug);
  if (pillar) return pillar.layer;
  const s = row.site;
  if (!s) return "next";
  if (s.kind === "demo" || s.status === "demo") return "demo";
  if (!OWN.has(s.owner)) return "client";
  if (s.status !== "live") return "next";
  return "product";
}

function orangecatUrl(row: RegisterRow): string | null {
  return row.orangecat ? `https://orangecat.ch/projects/${row.orangecat.projectId}` : null;
}

function solonUrl(row: RegisterRow): string | null {
  return row.solon ? `https://solon.orangecat.ch/orgs/${row.solon.slug}` : null;
}

function repoUrl(row: RegisterRow): string | null {
  return row.repo ? `https://github.com/bitbaum/${row.repo}` : null;
}

/** Trimmed, or null. An attribute of whitespace is not an answer. */
function prose(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** The four public attributes, in reading order, never any other key. */
export function publicIdentity(profile: MapProfile | undefined): MapIdentity {
  const src = profile?.identity ?? {};
  const out = {} as MapIdentity;
  for (const key of PUBLIC_IDENTITY_ATTRS) out[key] = prose(src[key]);
  return out;
}

/**
 * A goal row as a roadmap item: title, how far along, when, and the milestone
 * TITLES.
 *
 * `description` is deliberately dropped. Read in production on 2026-09-15, goal
 * descriptions are internal engineering notes carrying acceptance criteria —
 * "Acceptance: pushing main runs DB migrations", "HMAC entitlement webhook
 * verified". A public roadmap is what we are working on and how far along, not
 * the conditions under which an engineer may call it done. Publishing the
 * column because it was in the row is how explanatory fields become public
 * copy.
 *
 * Completed goals are kept: a roadmap that hides what shipped reads as though
 * nothing ever does.
 */
export function publicRoadmap(profile: MapProfile | undefined): MapRoadmapItem[] {
  return (profile?.goals ?? [])
    .filter((g) => prose(g.title))
    .map((g) => {
      const steps = (g.milestones ?? [])
        .map((m) => ({ title: prose(m?.title), done: m?.done === true }))
        .filter((m): m is MapMilestone => !!m.title);
      return {
        title: g.title.trim(),
        status: prose(g.status),
        progress: typeof g.progress === "number" ? g.progress : null,
        targetDate: g.targetDate ? g.targetDate.slice(0, 10) : null,
        // `done` rides along now. Dropping it published the one column of a
        // roadmap nobody can infer: four steps with no state next to "0%
        // recorded progress" says less than the row it came from.
        milestones: steps.filter((m) => !sourcePointer(m.title)),
        source: steps.map((m) => sourcePointer(m.title)).find((u) => u) ?? null,
      };
    });
}

/**
 * The `Source: https://…` entry that goal seeding leaves in a milestone list.
 *
 * It is provenance, not a step — nobody can tick it — and rendering it as one
 * put an unbreakable 90-character URL in the middle of public prose. Measured
 * at 390px on /fleet/heidi: 737px of content in a 390px column, clipped by an
 * ancestor's `overflow-x: hidden`, so 47% of every milestone line was
 * unreachable and there was no scrollbar to say so. Lifted out here and shown
 * as a link, the roadmap is steps again and the provenance is still published.
 */
function sourcePointer(title: string): string | null {
  const m = /^source:\s*(https?:\/\/\S+)$/i.exec(title.trim());
  return m ? m[1] : null;
}

/**
 * The dev log as a user-facing changelog: what was done, on which day.
 *
 * `next`, `tests`, `todos` and `health` are dropped. They are the operator's
 * working notes about a project, not an entry in its changelog, and the map
 * already publishes exactly one of them (`next`) as its own labelled field
 * rather than smuggling it inside an entry.
 *
 * Newest first, and capped: a changelog is a front page, not an export. A
 * consumer that wants everything has the project page.
 */
export function publicChangelog(profile: MapProfile | undefined, limit = 20): MapChangelogEntry[] {
  return (profile?.devLog ?? [])
    .filter((e) => e?.date && prose(e.done))
    .filter((e) => !isRunBookkeeping(e.done ?? ""))
    .map((e) => ({ date: e.date.slice(0, 10), done: (e.done ?? "").trim() }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

/**
 * A dev-log line that records a RUN, not a change to the product.
 *
 * `hostedRunDevLogEntry` writes one line per hosted run, prefixed with the
 * machine that did it — "Hosted dispatch (Hermes) FAILED — …". That line is
 * load-bearing for the next agent (it is the dossier's latest handoff) and it
 * is not a changelog entry: three of Heidi's six public entries were these,
 * two of them announcing a failed dispatch, and the oldest ones were stored
 * truncated mid-word by a bug fixed in #584 — so the public changelog of a
 * working product read "Hosted dispatch (Hermes) FAILED — Repo:
 * https://github.com/bitbaum/heidi (Next.js 16 App Route".
 *
 * Matched on the machine-written PREFIX only, never on prose. A filter that
 * guessed at meaning would eat real entries; this one keys on the exact label
 * its producer writes, so a change there fails the test beside it rather than
 * silently widening what the public page hides.
 *
 * Nothing is concealed by this: the run and its error live on the
 * orchestration run, in the activity feed, and in the last-run outcome the
 * catalogue already shows per project.
 */
function isRunBookkeeping(done: string): boolean {
  return /^hosted (dispatch|analysis)\b/i.test(done.trim());
}

export function buildFleetMap(
  rows: RegisterRow[],
  profiles: ReadonlyMap<string, MapProfile>,
  activity: ReadonlyMap<string, MapActivity>,
  now: Date = new Date(),
): FleetMap {
  const projects: FleetMapEntry[] = rows.map((row) => {
    const profile = profiles.get(row.slug);
    const act = activity.get(row.slug);
    const log = [...(profile?.devLog ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    // Dev-log dates arrive as timestamps; the map speaks in days.
    const logDate = log?.date ? log.date.slice(0, 10) : null;
    return {
      slug: row.slug,
      name: row.name,
      what: row.description,
      stack: profile?.stack?.trim() || null,
      layer: layerFor(row),
      // A project with no hosting row but a live URL IS live (loki and orangecat
      // are served from the main Caddyfile, not apps.conf); liveUrl is the SSOT
      // for "is it served", the register row only adds kind/owner/since.
      status: row.site?.status ?? (row.loki?.liveUrl ? "live" : "not live"),
      owner: row.site?.owner ?? "bitbaum",
      since: row.site?.since && row.site.since !== "-" ? row.site.since : null,
      urls: {
        live: row.site?.url ?? row.loki?.liveUrl ?? null,
        repo: repoUrl(row),
        orangecat: orangecatUrl(row),
        solon: solonUrl(row),
      },
      identity: publicIdentity(profile),
      roadmap: publicRoadmap(profile),
      changelog: publicChangelog(profile),
      next: log?.next?.trim() || null,
      now: {
        openRuns: act?.openRuns ?? 0,
        lastRun: act?.lastRun
          ? { outcome: act.lastRun.outcome, at: act.lastRun.at.toISOString() }
          : null,
        lastLog: log?.done && logDate ? { date: logDate, done: log.done.trim() } : null,
      },
    };
  });

  // Pillars first, then live products, then clients, demos, the rest — a map
  // reads top-down, so the shape of the studio is the first thing seen.
  const rank: Record<MapLayer, number> = {
    economic: 0,
    execution: 0,
    governance: 0,
    product: 1,
    client: 2,
    demo: 3,
    next: 4,
  };
  projects.sort((a, b) => rank[a.layer] - rank[b.layer] || a.slug.localeCompare(b.slug));

  return {
    generatedAt: now.toISOString(),
    thesis: THESIS,
    pillars: [...PILLARS],
    summary: {
      projects: projects.length,
      live: projects.filter((p) => p.status === "live").length,
      clients: projects.filter((p) => p.layer === "client").length,
      inFlight: projects.reduce((n, p) => n + p.now.openRuns, 0),
    },
    projects,
  };
}

/**
 * One line per project — the overview the assistant retrieves for "what do we
 * have?". Facts only, in a fixed order, so the same map always embeds the same.
 */
export function renderFleetMapOverview(map: FleetMap): string {
  const lines = [
    `Fleet map (${map.summary.projects} projects, ${map.summary.live} live, ${map.summary.clients} client systems). ${map.thesis}`,
    ...map.pillars.map((p) => `Pillar ${p.slug} (${p.layer} layer): ${p.role}`),
    ...map.projects.map((p) => {
      const bits = [
        `${p.slug} — ${p.what ?? "(no description yet)"}`,
        `${p.layer}, ${p.status}${p.owner !== "bitbaum" ? `, for ${p.owner}` : ""}`,
        p.urls.live ? `live at ${p.urls.live}` : null,
        p.urls.repo ? `code ${p.urls.repo}` : null,
        p.now.lastLog ? `last log ${p.now.lastLog.date}: ${p.now.lastLog.done}` : null,
        p.next ? `next: ${p.next}` : null,
      ].filter(Boolean);
      return bits.join("; ");
    }),
  ];
  return lines.join("\n");
}
