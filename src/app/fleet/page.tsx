import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  applyQuery,
  emptyQuery,
  isNarrowed,
  parseQuery,
  toggleFlag,
  toggleInSet,
  writeQuery,
  type ListQuery,
} from "listkit";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import { getSessionUserId } from "@/lib/session";
import { getPubliclyListedProjects } from "@/db/queries/user-projects";
import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { readAppsConf } from "@/lib/register/apps-conf";
import { buildFleetRegister, commerce, summarize, type RegisterRow } from "@/lib/register/build";
import { solonClaims } from "@/lib/register/solon";
import { orangecatProjectsThatResolve } from "@/lib/register/orangecat";
import {
  fleetListFor,
  groupOf,
  isDayZero,
  GROUP_LABEL,
  GROUP_OPTIONS,
  SORT_LABEL,
} from "@/config/fleet-list";

export const metadata: Metadata = {
  title: "The fleet",
  description:
    "Every project the studio runs, and where each one exists: a site, a Loki profile, an OrangeCat profile, a Solon organisation.",
};
export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;

/**
 * The register, rendered and searchable.
 *
 * The whole query lives in the URL and every control is a link or a GET form,
 * so this page needs no JavaScript to work, the back button behaves, and any
 * view of it can be sent to someone. That is not minimalism for its own sake:
 * the state of a list IS its address, and the moment those two diverge the
 * reader loses the ability to say "look at this one".
 *
 * The narrowing comes from `listkit`, which is shared across the fleet because
 * twelve repos had each written it once. What stays here is the markup and the
 * tokens, because every app in the fleet has to keep looking like itself.
 */
export default async function FleetRegisterPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const owner = await getSelfImprovementTarget();
  // Consent, not ownership. This page used to read the projects table for a
  // single chosen account — whichever owns the oldest entity named "loki" — and
  // publish every row it got back, because the row existed rather than because
  // anyone agreed. `owner` survives only to decide whether the VIEWER gets the
  // owner's editing affordances below; it no longer selects what is shown.
  // scripts/test/public-catalogue-consent.ts pins that.
  const projects = await getPubliclyListedProjects();
  const solon = await solonClaims();
  const apps = readAppsConf();
  const viewerId = await getSessionUserId();
  const viewerIsOwner = !!owner && viewerId === owner.userId;
  const canOpenProjects = !!viewerId;

  const rows = buildFleetRegister(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      slug: p.slug,
      hostedApp: p.hostedApp,
      gitUrl: p.gitUrl,
      liveUrl: p.liveUrl,
      orangecatProjectId: p.orangecatProjectId,
      solonOrgSlug: p.solonOrgSlug,
      isActive: p.isActive,
    })),
    apps,
    solon.claims,
  );

  const spec = fleetListFor(rows);
  const query = parseQuery(params, spec);
  const result = applyQuery(rows, spec, query);
  const s = summarize(rows);
  const money = viewerIsOwner ? commerce(apps) : null;
  const oc = await orangecatProjectsThatResolve(
    rows.map((r) => r.orangecat?.projectId).filter((id): id is string => !!id),
  );

  /** The same page with one thing about the query changed. */
  const href = (next: ListQuery) => `/fleet?${writeQuery(params, next, spec, query)}`;
  const withFacet = (key: string, value: string): ListQuery => ({
    ...query,
    facets: { ...query.facets, [key]: toggleInSet(query.facets[key] ?? [], value) },
  });
  const withFlag = (key: string): ListQuery => ({
    ...query,
    facets: { ...query.facets, [key]: toggleFlag(query.facets[key] ?? []) },
  });
  const on = (key: string, value?: string) =>
    value === undefined
      ? (query.facets[key]?.length ?? 0) > 0
      : (query.facets[key] ?? []).includes(value);

  const narrowed = isNarrowed(query);
  // Shown on the collapsed <summary>: a filter you cannot see is a filter you
  // forget you set, and then the empty result looks like a broken page.
  const activeFacetCount = Object.values(query.facets).reduce((n, vs) => n + (vs?.length ?? 0), 0);
  const kindOptions = (spec.facets.find((f) => f.key === "kind")?.options ?? []) as string[];
  const ownerOptions = (spec.facets.find((f) => f.key === "owner")?.options ?? []) as string[];

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-20 lg:py-24">
        <div className="ui-public-eyebrow">The fleet</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">Every project, and where it lives.</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">
          This is the studio&rsquo;s whole catalogue — products, client work, demos, and the ones
          still only named. Most of them run on one box, and Loki is what puts them there. Search
          it, narrow it, and send anyone the view you end up with.
        </p>
        <div className="ui-public-surface-card-meta">
          <span className="ui-public-surface-card-meta-chip">{s.projects} projects</span>
          <span className="ui-public-surface-card-meta-chip">{s.sites} sites</span>
          <span className="ui-public-surface-card-meta-chip">{s.orangecat} OrangeCat</span>
          <span className="ui-public-surface-card-meta-chip">
            {solon.checked ? `${s.solon} Solon` : "Solon unreachable"}
          </span>
        </div>
      </div>

      {/* The toolbar: a GET form and rows of links. No JavaScript, and the
          address bar is the state. */}
      <div className="ui-public-container-mid">
        <form method="GET" action="/fleet" className="ui-fleet-searchbar">
          {/* Carry the rest of the query through the submit — without these,
              searching would silently clear every filter the reader had set. */}
          {Object.entries(query.facets).flatMap(([k, vs]) =>
            vs.length ? [<input key={k} type="hidden" name={k} value={vs.join(",")} />] : [],
          )}
          {query.sort !== spec.defaultSort && (
            <input type="hidden" name="sort" value={query.sort} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder="Search name, address, description, client…"
            aria-label="Search the fleet"
            className="ui-fleet-search-input"
          />
          <button type="submit" className="ui-fleet-search-go ui-tap">
            Search
          </button>
        </form>

        {/* On a phone these four rows measured 366px, putting the first project
          at y=1020 — more than a screenful of filters before any of the
          catalogue they filter. <details> collapses them there and costs no
          JavaScript, which this page does not have and does not want; CSS
          forces it open from md up, so nothing changes on a desktop. */}
        <details className="ui-fleet-filters">
          <summary className="ui-fleet-filters-summary">
            <span>Filters</span>
            {activeFacetCount > 0 && (
              <span className="ui-fleet-filters-badge">{activeFacetCount}</span>
            )}
          </summary>

          <FacetRow label="Where">
            {GROUP_OPTIONS.map((g) => (
              <Chip
                key={g}
                href={href(withFacet("group", g))}
                active={on("group", g)}
                count={result.counts.group?.[g]}
              >
                {GROUP_LABEL[g]}
              </Chip>
            ))}
          </FacetRow>

          <FacetRow label="Kind">
            {kindOptions.map((k) => (
              <Chip
                key={k}
                href={href(withFacet("kind", k))}
                active={on("kind", k)}
                count={result.counts.kind?.[k]}
              >
                {k}
              </Chip>
            ))}
          </FacetRow>

          {ownerOptions.length > 0 && (
            <FacetRow label="For">
              {ownerOptions.map((o) => (
                <Chip
                  key={o}
                  href={href(withFacet("owner", o))}
                  active={on("owner", o)}
                  count={result.counts.owner?.[o]}
                >
                  {o}
                </Chip>
              ))}
            </FacetRow>
          )}

          {/* The register as a to-do list read sideways. These three are the
            reason it is worth keeping, and until there was a filter the only
            way to use them was to count 38 rows by eye. */}
          <FacetRow label="Missing">
            <Chip href={href(withFlag("nosite"))} active={on("nosite")}>
              no site
            </Chip>
            <Chip href={href(withFlag("noorangecat"))} active={on("noorangecat")}>
              no OrangeCat
            </Chip>
            <Chip href={href(withFlag("nosolon"))} active={on("nosolon")}>
              no Solon
            </Chip>
          </FacetRow>
        </details>

        <div className="ui-fleet-resultbar">
          <p className="ui-fleet-count">
            {result.matched === result.total
              ? `${result.total} projects`
              : `${result.matched} of ${result.total} projects`}
            {narrowed && (
              <>
                {" · "}
                <Link href={href(emptyQuery(spec))} className="ui-public-link-standalone">
                  clear
                </Link>
              </>
            )}
          </p>
          <div className="ui-fleet-sorts">
            <span className="ui-fleet-facet-label">Sort</span>
            {spec.sorts.map((sort) => (
              <Chip
                key={sort.key}
                href={href({
                  ...query,
                  sort: sort.key,
                  dir: sort.key === "newest" ? "desc" : "asc",
                })}
                active={query.sort === sort.key}
              >
                {SORT_LABEL[sort.key] ?? sort.key}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-public-container-mid space-y-12 pb-14 sm:space-y-16 sm:pb-24">
        <section className="pt-8 sm:pt-10">
          {result.rows.length === 0 ? (
            <div className="ui-fleet-empty">
              <p className="ui-public-section-lede">
                Nothing matches that. {narrowed ? "The filters are narrower than the fleet." : null}
              </p>
              <Link
                href={href(emptyQuery(spec))}
                className="ui-public-link-standalone mt-3 text-sm"
              >
                Clear the filters →
              </Link>
            </div>
          ) : (
            <ol className="ui-public-fleet-list">
              {result.rows.map((r) => (
                <Row
                  key={r.slug}
                  r={r}
                  solonChecked={solon.checked}
                  canOpenProjects={canOpenProjects}
                  orangecatLive={oc.live}
                />
              ))}
            </ol>
          )}
        </section>

        {money && (
          <section id="money" className="border-t border-border-subtle pt-10 sm:pt-16">
            <h2 className="ui-public-display-md">What it earns</h2>
            <p className="ui-public-section-lede mt-3 sm:mt-4">
              {money.engagements > 0 && money.paying === 0
                ? "Work shipped for other people, and what it is charged for. Right now that is nothing: every engagement is on favour terms. The sites are real; the invoices are the missing half."
                : "Work shipped for other people, and what it is charged for. Terms come from the hosting register, one line per site."}
            </p>
            <ul className="ui-public-fleet-stats mt-8">
              <li className="ui-public-fleet-stat">
                <span className="ui-public-fleet-stat-num-accent">{money.engagements}</span>
                <span className="ui-public-fleet-stat-label">
                  live engagements
                  {money.clients.length > 0 && <> — {money.clients.join(", ")}</>}
                </span>
              </li>
              <li className="ui-public-fleet-stat">
                <span className="ui-public-fleet-stat-num-accent">{money.paying}</span>
                <span className="ui-public-fleet-stat-label">
                  of them priced above zero. The rest are favours, recorded as such rather than left
                  blank
                </span>
              </li>
              <li className="ui-public-fleet-stat">
                <span className="ui-public-fleet-stat-num-accent">{money.pipeline}</span>
                <span className="ui-public-fleet-stat-label">
                  sites in the pipeline — prospects and unverified addresses, each one a
                  conversation that has not happened yet
                </span>
              </li>
            </ul>
          </section>
        )}

        <section className="border-t border-border-subtle pt-10 sm:pt-16">
          <h2 className="ui-public-display-md">What this page does not know</h2>
          <p className="ui-public-section-lede mt-3 sm:mt-4">
            &ldquo;Live&rdquo; here is what the hosting register declares, not a reading taken just
            now. A host that fell over ten minutes ago still says live on this page. Uptime is
            watched separately and alerts on its own; it does not feed this join yet. Saying so is
            cheaper than a status light that lies.
          </p>
          <Link href="/api/fleet/register" className="ui-public-link-standalone mt-4 text-sm">
            The same register, as data → /api/fleet/register
          </Link>
        </section>
      </div>

      <FinalCta />
    </PublicSurface>
  );
}

function FacetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-fleet-facet-row">
      <span className="ui-fleet-facet-label">{label}</span>
      <div className="ui-fleet-chips">{children}</div>
    </div>
  );
}

/**
 * One filter. A link, not a button — so it opens in a new tab, shows its
 * destination in the status bar, and works before any JavaScript arrives.
 *
 * The count is that option's own, computed with this facet's selection lifted:
 * while filtering by one kind, the number beside another kind still says how
 * many exist. A zero is worth seeing before the click rather than after.
 */
function Chip({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`ui-tap ${active ? "ui-fleet-chip-active" : "ui-fleet-chip"}`}
      aria-pressed={active}
    >
      {children}
      {count !== undefined && <span className="ui-fleet-chip-count">{count}</span>}
    </Link>
  );
}

/** Compare a name and a slug as the same word, ignoring case and separators. */
function norm(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function Row({
  r,
  solonChecked,
  canOpenProjects,
  orangecatLive,
}: {
  r: RegisterRow;
  solonChecked: boolean;
  canOpenProjects: boolean;
  orangecatLive: ReadonlySet<string>;
}) {
  const projectHref = r.loki && canOpenProjects ? `/projects/${r.loki.id}` : null;
  const publicProfileHref = `/fleet/${encodeURIComponent(r.slug)}`;
  return (
    // id = slug, so any single project is linkable: /fleet#causius.
    <li className="ui-public-fleet-row" id={r.slug}>
      <div className="min-w-0">
        {r.loki ? (
          <Link href={publicProfileHref} className="ui-public-fleet-name">
            {r.name ?? r.slug}
          </Link>
        ) : (
          <div className="ui-public-fleet-name">{r.name ?? r.slug}</div>
        )}
        {r.description ? (
          <div className="ui-public-fleet-what">{r.description}</div>
        ) : (
          r.name &&
          norm(r.name) !== norm(r.slug) && <div className="ui-public-fleet-slug">{r.slug}</div>
        )}
      </div>
      <div className="min-w-0">
        {r.site ? (
          <>
            <a
              href={r.site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-public-fleet-site"
            >
              {r.site.host}
            </a>
            <div className="ui-public-fleet-slug">
              {/* A day-zero address answers 200 with six to seventeen kilobytes
                  of scaffold. Saying so is the difference between a reader
                  trusting this list and concluding a third of it is broken. */}
              {isDayZero(r) ? <span className="ui-fleet-dayzero">day-zero page</span> : r.site.kind}
              {" · "}
              {r.site.status}
              {r.site.owner !== "bitbaum" && r.site.owner !== "-" && (
                <span className="ui-public-fleet-nowrap"> · for {r.site.owner}</span>
              )}
              {r.site.since !== "-" && (
                <span className="ui-public-fleet-nowrap"> · since {r.site.since}</span>
              )}
            </div>
          </>
        ) : (
          <span className="ui-public-fleet-none">
            {groupOf(r) === "profile" ? "no site yet" : "no site"}
          </span>
        )}
      </div>
      <div className="ui-public-fleet-presence">
        <Presence label="Loki" href={projectHref} present={!!r.loki} flatReason="sign in to open" />
        <Presence
          label="OrangeCat"
          href={
            r.orangecat && orangecatLive.has(r.orangecat.projectId)
              ? `https://orangecat.ch/projects/${r.orangecat.projectId}`
              : null
          }
          external
          present={!!r.orangecat}
        />
        {/* Solon publishes no per-organisation page — only `GET /api/orgs/<slug>`,
            which is how this register knows the organisation exists. */}
        <Presence label="Solon" href={null} present={!!r.solon} unknown={!solonChecked} />
      </div>
    </li>
  );
}

function Presence({
  label,
  href,
  external,
  unknown,
  present,
  flatReason,
}: {
  label: string;
  href: string | null;
  external?: boolean;
  unknown?: boolean;
  /** Exists, but this reader cannot open it. Absence and "not for you" are
      different facts and must not render the same. */
  present?: boolean;
  /** Why it is not a link, for the tooltip. */
  flatReason?: string;
}) {
  if (!href) {
    if (present) {
      return (
        <span className="ui-public-fleet-presence-flat" title={flatReason ?? "no page to open"}>
          {label}
        </span>
      );
    }
    return (
      <span
        className="ui-public-fleet-presence-off"
        title={unknown ? "could not check" : "not yet"}
      >
        {label}
        {unknown ? " ?" : ""}
      </span>
    );
  }
  return external ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ui-public-fleet-presence-on"
    >
      {label} ↗
    </a>
  ) : (
    <Link href={href} className="ui-public-fleet-presence-on">
      {label}
    </Link>
  );
}
