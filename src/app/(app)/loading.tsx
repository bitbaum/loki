/**
 * What a page shows while its data is on the way: the shape the page will
 * have. Since the design reset every collection is rows (`List` + `ListRow`),
 * so the placeholder is rows too, built on the same classes so nothing jumps
 * when the real ones arrive. It used to draw a title, a sentence under it and
 * four cards in a grid — a layout no page has any more.
 *
 * The title bar is drawn from md up only: on a phone the top bar names the
 * page (PageLayout does the same).
 */
const ROWS: Array<[string, string]> = [
  ["w-2/5", "w-3/5"],
  ["w-1/3", "w-1/2"],
  ["w-1/2", "w-2/3"],
  ["w-1/4", "w-2/5"],
  ["w-2/5", "w-1/2"],
  ["w-1/3", "w-3/5"],
];

export default function Loading() {
  return (
    <div
      className="app-page max-w-4xl space-y-6 md:space-y-8"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="hidden h-8 w-40 rounded-lg bg-surface-raised motion-safe:animate-pulse md:block" />
      <ul className="ui-list motion-safe:animate-pulse" aria-hidden="true">
        {ROWS.map(([title, line], i) => (
          <li key={i} className="ui-listrow">
            <span className="ui-listrow-lead">
              <span className="h-10 w-10 rounded-full bg-surface-raised" />
            </span>
            <span className="ui-listrow-main">
              <span className="ui-listrow-text gap-2">
                <span className={`h-4 rounded bg-surface-raised ${title}`} />
                <span className={`h-3 rounded bg-surface-raised ${line}`} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
