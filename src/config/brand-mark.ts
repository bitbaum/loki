// SSOT for the Loki brand mark — a rotorelief. After Duchamp's discs in
// Anémic Cinéma (1926): an Archimedean coil cut out of a disc, its inner turns
// drifting off centre and crowding toward the middle like a corridor seen in
// perspective. Still, it reads as a spiral; turned (a plain CSS rotate of the
// whole disc), the eye reads a tunnel that breathes. Turning clockwise pours
// inward, anticlockwise flows out — the voice screen uses that to say whose
// turn it is.
//
// EVERY rendered asset (favicon, desktop tray icon, desktop app icon,
// OpenGraph images, the in-app marks, the widget) derives its geometry from
// `markPathD()` here. Never hand-redraw the mark anywhere else — that was the
// old bug (3 divergent copies + a tray glyph that drew a different shape).
//
// Regenerate the static raster/vector assets after changing any parameter:
//   npm run generate:brand
//   npx tsx scripts/generate-widget-brand-mark.ts

import { PALETTE } from "@/lib/palette";

export const BRAND_MARK = {
  /** Square viewBox edge. All coordinates below live in this space. */
  viewBox: 100,
  /** Radius of the disc. The glyph fills the box edge to edge. */
  discRadius: 47,
  /** Outermost coil radius as a share of the disc, leaving a solid rim. */
  coilShare: 0.86,
  /** Full turns of the coil. Small renders pass fewer — see `MARK_TURNS`. */
  turns: 4,
  /** How far the innermost turn drifts off centre, in viewBox units. This is
   *  what turns rotation into depth. */
  depth: 10,
  /** Perspective: >1 crowds and thins the inner turns. */
  perspective: 1.6,
  /** Share of each turn's pitch that is cut away (the rest is disc). */
  cut: 0.5,
  /** Direction the inner turns drift toward (radians; up-left). */
  drift: -2.4,
  /** Radius of the round "pupil" cut at the vanishing point. */
  pupil: 2.4,
  /** Polyline samples per turn — higher is smoother. */
  samplesPerTurn: 120,
} as const;

export type BrandMarkParams = { -readonly [K in keyof typeof BRAND_MARK]: number };

/** Optical sizes: like a typeface, the coil sheds turns as it shrinks so the
 *  disc still reads at a favicon. Pick by the rendered edge in CSS px. */
export const MARK_TURNS = {
  /** ≤ 24px — tray glyph, inline avatars, header marks. */
  tiny: 2.2,
  /** ≤ 64px — favicon, app chrome. */
  small: 3.2,
  /** Install icons and anything larger. */
  large: 4,
  /** Hero renders — OG card, the voice disc. */
  hero: 5,
} as const;

const fmt = (n: number) => n.toFixed(2);

/** The coil as a filled outline (outer edge forward, inner edge back), so the
 *  band can thin toward the centre — a stroke cannot vary its width. */
function coilOutline(m: BrandMarkParams): string {
  const cx = m.viewBox / 2;
  const cy = m.viewBox / 2;
  const R = m.discRadius * m.coilShare;
  // Start outside the pupil so the two cuts never overlap (evenodd would
  // fill an overlap back in).
  const r0 = m.pupil + 1.6;
  const thetaMax = m.turns * 2 * Math.PI;
  const n = Math.max(8, Math.round(m.turns * m.samplesPerTurn));
  const pts: [number, number][] = [];
  const widths: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n; // 0 = centre, 1 = outer tail
    const theta = u * thetaMax;
    const r = r0 + (R - r0) * Math.pow(u, m.perspective);
    // Drift changes slowly near the centre (u²), so inner turns never touch.
    const off = m.depth * (1 - u * u);
    pts.push([
      cx + off * Math.cos(m.drift) + r * Math.cos(theta),
      cy + off * Math.sin(m.drift) + r * Math.sin(theta),
    ]);
    const pitch =
      ((R - r0) * m.perspective * Math.pow(Math.max(u, 0.02), m.perspective - 1)) / m.turns;
    const tail = u > 0.9 ? Math.pow((1 - u) / 0.1, 0.6) : 1; // taper the outer end
    const head = Math.min(1, u / 0.04);
    widths.push(pitch * m.cut * tail * head);
  }
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const h = widths[i] / 2;
    left.push(`${fmt(pts[i][0] - ty * h)} ${fmt(pts[i][1] + tx * h)}`);
    right.push(`${fmt(pts[i][0] + ty * h)} ${fmt(pts[i][1] - tx * h)}`);
  }
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

const circle = (cx: number, cy: number, r: number) =>
  `M${fmt(cx - r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`;

/** The whole mark as ONE path: the disc, with the coil and pupil cut out.
 *  Render it with `fill-rule="evenodd"` (`fillRule="evenodd"` in JSX) and
 *  `fill="currentColor"` — the cuts show whatever sits behind, so it themes on
 *  any surface. Rotate the element to animate; the disc is round, so a rigid
 *  turn is exactly Duchamp's turntable. */
export function markPathD(opts: Partial<BrandMarkParams> = {}): string {
  const m: BrandMarkParams = { ...BRAND_MARK, ...opts };
  const c = m.viewBox / 2;
  return [
    circle(c, c, m.discRadius),
    coilOutline(m),
    circle(c + m.depth * Math.cos(m.drift), c + m.depth * Math.sin(m.drift), m.pupil),
  ].join("");
}

/** Full standalone `<svg>` markup for the mark. Used by the asset generators
 *  (favicon/tray/app icon). In React components render `<LokiMark>`
 *  (src/components/shell/LokiMark.tsx) so it themes via currentColor. */
export function brandMarkSvg(
  opts: {
    size?: number;
    /** Disc colour. Defaults to the dark text-primary mirror. */
    fill?: string;
    /** When set, draws a rounded-rect tile behind the disc (app icon /
     *  favicon); the disc shrinks so the tile shows a margin around it. Omit
     *  for a transparent glyph (tray icon / inline mark). */
    background?: string;
    /** Tile corner radius in viewBox units. */
    radius?: number;
    turns?: number;
  } = {},
): string {
  const vb = BRAND_MARK.viewBox;
  const size = opts.size ?? vb;
  const fill = opts.fill ?? PALETTE.dark.textPrimary;
  const bg = opts.background
    ? `<rect width="${vb}" height="${vb}" rx="${opts.radius ?? 22}" fill="${opts.background}"/>`
    : "";
  const d = markPathD({
    turns: opts.turns ?? BRAND_MARK.turns,
    ...(opts.background ? { discRadius: 41, depth: BRAND_MARK.depth * (41 / 47) } : {}),
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}">` +
    bg +
    `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>` +
    `</svg>`
  );
}
