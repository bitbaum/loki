import Link from "next/link";
import { FLEET_RUNNER_RELEASES, CURRENT_RELEASE, PLATFORM_CHANGELOG } from "@/config/changelog";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { longDate } from "@/lib/dates";

export const metadata = {
  title: "Changelog",
  description: "Fleet Runner changelog: what changed in each release, and why.",
};

const RELEASES_GH_BASE = "https://github.com/bitbaum/loki-releases/releases/tag";

type FleetRunnerRelease = (typeof FLEET_RUNNER_RELEASES)[number];

// "0.8.9" → "0.8" — releases are grouped by minor line so only the current
// line renders expanded; older lines collapse into <details>.
function minorOf(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

function ReleaseArticle({ release, isLatest }: { release: FleetRunnerRelease; isLatest: boolean }) {
  return (
    <article id={release.tag} className="ui-changelog-entry scroll-mt-24">
      <div className="ui-changelog-meta">
        <time className="ui-changelog-date" dateTime={release.date}>
          {longDate(release.date)}
        </time>
        <span className="ui-changelog-version">v{release.version}</span>
        {isLatest && <span className="ui-changelog-current">Latest</span>}
      </div>

      <h3 className="ui-changelog-entry-title">Fleet Runner {release.version}</h3>

      {release.notes && <p className="ui-changelog-notes">{release.notes}</p>}

      {release.highlights.length > 0 && (
        <ul className="ui-changelog-list">
          {release.highlights.map((line) => (
            <li key={line} className="ui-changelog-item">
              <span className="ui-changelog-bullet" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {release.breaking.length > 0 && (
        <div className="ui-changelog-breaking">
          <div className="ui-changelog-breaking-label">Breaking</div>
          <ul className="ui-changelog-list">
            {release.breaking.map((line) => (
              <li key={line} className="ui-changelog-item">
                <span className="ui-changelog-bullet" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ui-changelog-foot">
        <a
          href={`${RELEASES_GH_BASE}/${release.tag}`}
          target="_blank"
          rel="noreferrer"
          className="ui-changelog-link"
        >
          Binaries →
        </a>
        <span className="ui-changelog-tag">{release.tag}</span>
      </div>
    </article>
  );
}

export default function ReleasesPage() {
  const latestMinor = minorOf(FLEET_RUNNER_RELEASES[0].version);
  const currentLine = FLEET_RUNNER_RELEASES.filter((r) => minorOf(r.version) === latestMinor);
  // Older minor lines, in release order — each becomes one collapsed group.
  const olderLines: { minor: string; releases: FleetRunnerRelease[] }[] = [];
  for (const release of FLEET_RUNNER_RELEASES) {
    const minor = minorOf(release.version);
    if (minor === latestMinor) continue;
    const last = olderLines[olderLines.length - 1];
    if (last && last.minor === minor) last.releases.push(release);
    else olderLines.push({ minor, releases: [release] });
  }

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-changelog-root">
        <div className="ui-changelog-page">
          <header>
            <div className="ui-changelog-eyebrow">Changelog</div>
            <h1 className="ui-changelog-title">Loki</h1>
            <p className="ui-changelog-lede">
              What shipped, what changed, and why — platform milestones and each Fleet Runner
              release. The latest runner is{" "}
              <span className="ui-changelog-code">v{CURRENT_RELEASE.version}</span>, published{" "}
              {longDate(CURRENT_RELEASE.date)}.
            </p>
            <div className="ui-changelog-foot">
              <Link href="/download" className="ui-changelog-link">
                Download latest →
              </Link>
              <a
                href="https://github.com/bitbaum/loki-releases/releases"
                target="_blank"
                rel="noreferrer"
                className="ui-changelog-link"
              >
                GitHub releases →
              </a>
            </div>
            {/* Compact version index — current-line versions jump to their entry;
              archived versions jump to their collapsed minor-line group. */}
            <nav className="ui-changelog-index" aria-label="Version index">
              {FLEET_RUNNER_RELEASES.map((release) => {
                const minor = minorOf(release.version);
                const target = minor === latestMinor ? release.tag : `line-${minor}`;
                return (
                  <a key={release.tag} href={`#${target}`} className="ui-changelog-index-link">
                    v{release.version}
                  </a>
                );
              })}
            </nav>
          </header>

          {PLATFORM_CHANGELOG.length > 0 && (
            <div className="ui-changelog-feed">
              <h2 className="ui-changelog-title">Platform</h2>
              {PLATFORM_CHANGELOG.map((entry, idx) => (
                <article key={`${entry.date}-${entry.title}`} className="ui-changelog-entry">
                  <div className="ui-changelog-meta">
                    <time className="ui-changelog-date" dateTime={entry.date}>
                      {longDate(entry.date)}
                    </time>
                    {idx === 0 && <span className="ui-changelog-current">Latest</span>}
                  </div>

                  <h3 className="ui-changelog-entry-title">{entry.title}</h3>

                  <ul className="ui-changelog-list">
                    {entry.highlights.map((line) => (
                      <li key={line} className="ui-changelog-item">
                        <span className="ui-changelog-bullet" aria-hidden />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  {entry.link && (
                    <div className="ui-changelog-foot">
                      <Link href={entry.link.href} className="ui-changelog-link">
                        {entry.link.label} →
                      </Link>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          <div className="ui-changelog-feed">
            <h2 className="ui-changelog-title">Fleet Runner</h2>
            {currentLine.map((release, idx) => (
              <ReleaseArticle key={release.tag} release={release} isLatest={idx === 0} />
            ))}

            {/* Everything below the current minor line collapses — 20+ expanded
              patch entries buried the page; the archive stays one click (and
              zero JS) away, links intact for crawlers. */}
            {olderLines.map(({ minor, releases }) => (
              <details
                key={minor}
                id={`line-${minor}`}
                className="ui-changelog-archive scroll-mt-24"
              >
                <summary className="ui-changelog-archive-summary">
                  v{minor}.x — {releases.length} {releases.length === 1 ? "release" : "releases"}
                  <span className="ui-changelog-archive-range">
                    {longDate(releases[releases.length - 1].date)} – {longDate(releases[0].date)}
                  </span>
                </summary>
                {releases.map((release) => (
                  <ReleaseArticle key={release.tag} release={release} isLatest={false} />
                ))}
              </details>
            ))}
          </div>
        </div>
      </div>
    </PublicSurface>
  );
}
