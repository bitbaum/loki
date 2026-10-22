import Link from "next/link";
import { ChevronRight, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A collection, drawn as rows — design reset rule 3
 * (docs/development/design-reset-2026-10.md).
 *
 * The reference apps (Claude, ChatGPT, Grok) list things the same way: an icon
 * or avatar, a name, ONE grey line, a date on the right. Loki's rows carried
 * four to six badges, counts and coloured words each, and every collection sat
 * in a bordered card. A row here has exactly these slots, and no others:
 *
 *   <List aria-label="Robots">
 *     <ListRow
 *       href={`/robots/${r.id}`}
 *       icon={Bot}
 *       title={r.name}
 *       secondary="Vacuum · iRobot Roomba j7+"
 *       trailing="2d"
 *       chevron
 *     />
 *   </List>
 *
 * - `href` or `onClick` makes the WHOLE row the link/button (56px+ tall);
 *   neither leaves it a plain row.
 * - `secondary` is one line, cut with an ellipsis. Status goes here as a word,
 *   with `status` adding a small dot in front — never a row of badges.
 * - `trailing` is one fact (a time, a count); `chevron` says "opens a page".
 * - `menu` is the row's own `…` (usually <RowActions>), for the actions that
 *   are not the row's main one. It sits above the row's link, so it never
 *   opens the row by accident.
 */
export function List({
  children,
  className,
  ...aria
}: {
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <ul className={cn("ui-list", className)} {...aria}>
      {children}
    </ul>
  );
}

type RowStatus = "positive" | "warning" | "negative" | "neutral";

export function ListRow({
  href,
  onClick,
  icon: Icon,
  avatar,
  title,
  secondary,
  status,
  trailing,
  chevron = false,
  menu,
  external = false,
  className,
}: {
  /** The row opens this page. */
  href?: string;
  /** `href` is another site: it opens in a new tab. */
  external?: boolean;
  /** Or the row does this. Ignored when `href` is set. */
  onClick?: () => void;
  /** Leading icon (20px, secondary ink). */
  icon?: LucideIcon;
  /** Leading circle instead of an icon: an initial or an <img>. */
  avatar?: React.ReactNode;
  title: React.ReactNode;
  /** The ONE grey line under the title. */
  secondary?: React.ReactNode;
  /** A small dot before the secondary line — only for a state worth acting on. */
  status?: RowStatus;
  /** One fact on the right: a time or a count. */
  trailing?: React.ReactNode;
  /** A chevron at the end: the row opens a page. */
  chevron?: boolean;
  /** The row's own `…` menu. */
  menu?: React.ReactNode;
  className?: string;
}) {
  const interactive = !!href || !!onClick;
  const titleNode = <span className="ui-listrow-title">{title}</span>;
  const hit = href ? (
    external ? (
      <a href={href} target="_blank" rel="noreferrer" className="ui-listrow-hit ui-listrow-title">
        {title}
      </a>
    ) : (
      <Link href={href} className="ui-listrow-hit ui-listrow-title">
        {title}
      </Link>
    )
  ) : onClick ? (
    <button type="button" onClick={onClick} className="ui-listrow-hit ui-listrow-title">
      {title}
    </button>
  ) : (
    titleNode
  );

  return (
    <li className={cn("ui-listrow", interactive && "ui-listrow-interactive", className)}>
      {(Icon || avatar) && (
        <span className={cn("ui-listrow-lead", avatar && "ui-listrow-avatar")} aria-hidden>
          {avatar ?? (Icon && <Icon className="h-5 w-5" />)}
        </span>
      )}
      <div className="ui-listrow-main">
        <div className="ui-listrow-text">
          {hit}
          {secondary && (
            <span className="ui-listrow-secondary">
              {status && <span className={`ui-dot ui-dot-${status}`} aria-hidden />}
              <span className="ui-listrow-secondary-text">{secondary}</span>
            </span>
          )}
        </div>
        {trailing !== undefined && trailing !== null && trailing !== "" && (
          <span className="ui-listrow-trail">{trailing}</span>
        )}
        {menu && <div className="ui-listrow-menu">{menu}</div>}
        {chevron && <ChevronRight className="ui-listrow-chevron" aria-hidden />}
      </div>
    </li>
  );
}

/** The leading initial for a row about something with a name. */
export function RowInitial({ name }: { name: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return <>{letter}</>;
}

/**
 * A list's search box, drawn as the list's first row (rule 6): it scrolls away
 * with the list instead of pinning a block above it. Escape clears it.
 */
export function ListSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name when the placeholder is not enough. */
  label?: string;
}) {
  return (
    <div className="ui-list-search">
      <Search className="ui-list-search-icon" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="ui-list-search-input"
      />
    </div>
  );
}
