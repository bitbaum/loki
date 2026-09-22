import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check } from "lucide-react";
import { loadFleetMap, publiclyListedSlugs } from "@/lib/register/load-map";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { humanizeAttrKey } from "@/config/project-attrs";
import { longDate } from "@/lib/dates";
import type { FleetMapEntry, MapRoadmapItem } from "@/lib/register/map";

/**
 * A project's public build profile — what Loki publishes about ONE project to
 * a reader with no account.
 *
 * This is the page every "via Loki" link on an OrangeCat wall should have been
 * pointing at, and the page nothing measured: the responsive gate's coverage
 * test skips any route containing "[", so the one template that renders all 36
 * projects' public profiles had never been driven through a viewport. What it
 * was serving at 390px, measured 2026-09-21: 737px of roadmap content in a
 * 390px column, clipped by the surface's own `overflow-x: hidden` so that 47%
 * of every milestone line was unreachable with no scrollbar to hint at it;
 * three of six changelog entries were internal dispatch bookkeeping, two of
 * them announcing a FAILED dispatch and stored truncated mid-word; and the
 * footer printed a raw ISO timestamp.
 *
 * The rendering rules that follow from that, in order of how much they matter:
 *
 *   - Nothing is shown that the reader cannot read. Long unbreakable tokens
 *     (URLs, hashes, paths) wrap — the fix lives on the `.ui-public-*` prose
 *     tokens in globals.css, so it holds for every public page, not this one.
 *   - Written and not-written render differently. `null` means nobody has
 *     written it yet and invites someone to; it does not print "Not recorded
 *     yet." four times as though absence were content.
 *   - What the reader came for is above what the operator came for: the
 *     product's own site and its source are in the header, not three sections
 *     down under "Technical context".
 */
export const dynamic = "force-dynamic";
export default async function PublicProjectProfile({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [map, listed] = await Promise.all([loadFleetMap(), publiclyListedSlugs()]);
  if (!map)
    return (
      <PublicSurface right={<PublicHeaderActions />}>
        <div className="ui-public-container-mid py-12">
          <h1 className="ui-public-page-title">Profiles temporarily unavailable</h1>
          <p className="ui-public-section-lede mt-4">Please retry shortly.</p>
        </div>
      </PublicSurface>
    );
  const project = map.projects.find((p) => p.slug === slug);
  // Consent, not ownership — and an unknown slug and an unconsented one take
  // the same exit, so this page never reveals that a private project exists.
  if (!project || !listed.has(project.slug)) notFound();

  const sections = visibleSections(project);
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-20">
        <Link href="/fleet" className="ui-public-link">
          All projects
        </Link>
        <h1 className="ui-public-page-title mt-6">{project.name}</h1>
        <p className="ui-public-lede mt-4">
          {project.what ?? "Purpose has not been recorded yet."}
        </p>
        <p className="ui-public-meta mt-4">{statusLine(project)}</p>

        {/* The two links a reader wants first: the thing itself, and its code. */}
        <div className="mt-6 flex flex-wrap gap-3">
          {externalLinks(project).map(({ label, url }) => (
            <a key={label} className="ui-btn-chip" href={url}>
              {label}
              <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </a>
          ))}
        </div>

        {sections.length > 1 && (
          <nav aria-label="Project context" className="ui-public-jumpbar">
            {sections.map((s) => (
              <a key={s.id} className="ui-public-jumpbar-link" href={`#${s.id}`}>
                {s.label}
              </a>
            ))}
          </nav>
        )}

        {sections.some((s) => s.id === "purpose") && (
          <section id="purpose" className="mt-12 space-y-8">
            {identityEntries(project).map(([key, value]) => (
              <div key={key}>
                <h2 className="ui-public-display-md">{humanizeAttrKey(key)}</h2>
                <p className="ui-public-section-lede mt-3">{value}</p>
              </div>
            ))}
          </section>
        )}

        <section id="technical" className="mt-12">
          <h2 className="ui-public-display-md">Technical context</h2>
          <p className="ui-public-section-lede mt-3">
            {project.stack ?? "The stack has not been written down yet."}
          </p>
          <Link href={fleetSurfaceHref("chat", project.slug)} className="ui-btn-chip mt-6">
            Investigate this project with Loki →
          </Link>
          <p className="ui-public-meta mt-3">
            Sign in to ask about architecture, evidence, delivery risks and next steps in your
            workspace.
          </p>
        </section>

        {sections.some((s) => s.id === "roadmap") && (
          <section id="roadmap" className="mt-12">
            <h2 className="ui-public-display-md">Roadmap</h2>
            <ol className="mt-6 space-y-8">
              {project.roadmap.map((item, i) => (
                <li key={`${item.title}-${i}`}>
                  <h3 className="ui-public-prose-strong">{item.title}</h3>
                  <p className="ui-public-meta mt-1">{roadmapMeta(item)}</p>
                  {item.milestones.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {item.milestones.map((m) => (
                        <li className="flex gap-2.5" key={m.title}>
                          <span
                            className="ui-public-milestone-mark"
                            data-done={m.done ? "true" : "false"}
                            aria-hidden
                          >
                            {m.done ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="ui-public-prose-muted min-w-0">
                            {m.title}
                            <span className="sr-only">{m.done ? " — done" : " — not done"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.source && (
                    <a className="ui-public-link mt-3 inline-block text-sm" href={item.source}>
                      Where this comes from
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {sections.some((s) => s.id === "changelog") && (
          <section id="changelog" className="mt-12">
            <h2 className="ui-public-display-md">Changelog</h2>
            <ol className="mt-6 space-y-6">
              {project.changelog.map((item, i) => (
                <li key={`${item.date}-${i}`}>
                  <h3 className="ui-public-meta">{longDate(item.date)}</h3>
                  <p className="ui-public-prose-muted mt-1 whitespace-pre-wrap">{item.done}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {sections.length === 0 && (
          <section className="mt-12">
            <h2 className="ui-public-display-md">Nothing published yet</h2>
            <p className="ui-public-section-lede mt-3">
              This project is running, but its purpose, roadmap and changelog have not been written
              down yet. They are published from the project&apos;s own record in Loki — whoever
              builds it can fill them in from their workspace, and this page follows.
            </p>
          </section>
        )}

        <p className="ui-public-meta mt-12">
          Roadmap and changelog come from this project&apos;s canonical development record, read{" "}
          {longDate(map.generatedAt)}.
        </p>
      </div>
    </PublicSurface>
  );
}

type Section = { id: string; label: string };

/**
 * The sections this project actually has. An anchor bar that jumps to three
 * empty headings is worse than no anchor bar: at 390px it is also the one row
 * on the page that scrolls sideways, so every entry in it has to be worth the
 * horizontal room it takes.
 */
function visibleSections(project: FleetMapEntry): Section[] {
  const out: Section[] = [];
  if (identityEntries(project).length > 0) out.push({ id: "purpose", label: "Purpose" });
  out.push({ id: "technical", label: "Technical context" });
  if (project.roadmap.length > 0) out.push({ id: "roadmap", label: "Roadmap" });
  if (project.changelog.length > 0) out.push({ id: "changelog", label: "Changelog" });
  return out;
}

/** Only the identity attributes somebody has actually written. */
function identityEntries(project: FleetMapEntry): [string, string][] {
  return Object.entries(project.identity).filter((e): e is [string, string] => !!e[1]);
}

/** What state the project is in, in a reader's words rather than a column's. */
function statusLine(project: FleetMapEntry): string {
  if (project.status === "live" || project.status === "validating")
    return "Beta — running, not released";
  if (project.status === "not live") return "Not running yet";
  return project.status;
}

/**
 * Progress only when it means something. A goal seeded from a spec carries
 * `progress: 0`, and "0% recorded progress" printed under every item read as a
 * measurement of the project rather than of what nobody has ticked yet.
 */
function roadmapMeta(item: MapRoadmapItem): string {
  const done = item.milestones.filter((m) => m.done).length;
  return [
    item.status ?? "status not recorded",
    item.milestones.length > 0 ? `${done}/${item.milestones.length} steps done` : null,
    item.targetDate ? `target ${longDate(item.targetDate)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The project's own addresses, labelled for a reader, in reading order. */
function externalLinks(project: FleetMapEntry): { label: string; url: string }[] {
  const { live, repo, orangecat, solon } = project.urls;
  return [
    live ? { label: "Open the product", url: live } : null,
    repo ? { label: "Source code", url: repo } : null,
    orangecat ? { label: "Back it on OrangeCat", url: orangecat } : null,
    solon ? { label: "Governance on Solon", url: solon } : null,
  ].filter((l): l is { label: string; url: string } => !!l);
}
