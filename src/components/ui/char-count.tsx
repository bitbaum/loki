/**
 * How much of a length limit a text box has used — shown once it matters,
 * never a silent cut.
 *
 * The rule it enforces: a box does not quietly drop what a person typed or
 * pasted. `maxLength` on a textarea truncates a paste with no signal at all,
 * which is how an owner's 8.5k-character doctrine lost its last 542
 * characters on "Sync from doc" (2026-09-25), and how five interview answers
 * were cut mid-sentence the day before. So long-text boxes keep the text,
 * this line says how far over it is, and the submit button refuses with the
 * same words.
 */
export function charCountState(length: number, max: number, showAt = 0.6) {
  return {
    visible: length >= max * showAt,
    over: length > max,
    atLimit: length === max,
  };
}

export function CharCount({
  length,
  max,
  id,
  showAt = 0.6,
  overHint = "Shorten it, or split it into two passes.",
}: {
  length: number;
  max: number;
  id?: string;
  /** Fraction of `max` at which the count appears, so short text stays quiet. */
  showAt?: number;
  /** What to do about it, said once the text is over. */
  overHint?: string;
}) {
  const { visible, over } = charCountState(length, max, showAt);
  if (!visible) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <p id={id} aria-live="polite" className={over ? "ui-char-count-full" : "ui-char-count"}>
      {over
        ? `${fmt(length)} of ${fmt(max)} — ${fmt(length - max)} over. Nothing was cut. ${overHint}`
        : `${fmt(length)} of ${fmt(max)}`}
    </p>
  );
}
