/**
 * A settings list: one row per setting — what it is and its current value on
 * the left, its actions on the right (under it on a phone), every action the
 * same bordered 44px shape.
 *
 * It replaced a section where "Website", "Own domain", "Share" and "List
 * publicly" were bare ghost text, "Open repository" a bordered button and the
 * edit control a lone pencil, at three sizes side by side (owner, 2026-10-19:
 * "just ugly and hard to understand what they're even for"). The row names
 * what each control is FOR before you reach it; the action styling is
 * enforced by `.ui-setting-actions`, so a control dropped in keeps the shape.
 */
export function SettingRows({ children }: { children: React.ReactNode }) {
  return <ul className="ui-setting-rows">{children}</ul>;
}

export function SettingRow({
  title,
  note,
  children,
}: {
  title: React.ReactNode;
  /** The current value, or one sentence on what the setting does. */
  note?: React.ReactNode;
  /** The row's actions. */
  children?: React.ReactNode;
}) {
  return (
    <li className="ui-setting-row">
      <div className="min-w-0 flex-1">
        <h3 className="ui-setting-row-title">{title}</h3>
        {note && <div className="ui-setting-row-note">{note}</div>}
      </div>
      {children && <div className="ui-setting-actions">{children}</div>}
    </li>
  );
}
