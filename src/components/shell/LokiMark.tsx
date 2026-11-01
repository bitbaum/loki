import { BRAND_MARK, markPathD, MARK_TURNS } from "@/config/brand-mark";

/**
 * Loki's rotorelief disc, drawn from the SSOT (src/config/brand-mark.ts). One
 * evenodd path filled with currentColor: the coil is cut out, so it themes on
 * any surface. Rotate the element (CSS) to animate it.
 */
export function LokiMark({
  turns = "small",
  depth,
  className,
  size,
}: {
  /** Optical size — fewer turns for smaller renders. */
  turns?: keyof typeof MARK_TURNS;
  /** Off-centre drift; the voice screen drives it with loudness. */
  depth?: number;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BRAND_MARK.viewBox} ${BRAND_MARK.viewBox}`}
      className={className}
      aria-hidden="true"
    >
      <path
        d={markPathD({ turns: MARK_TURNS[turns], ...(depth === undefined ? {} : { depth }) })}
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
