// The launcher must never cover somebody else's control.
//
// Every mainstream chat widget defaults to bottom-right, and so do we — with a
// near-maximum z-index, so we win and hide THEIR control. The slot order and
// chooser are what stop that, and they run on sites we cannot see, so they are
// pinned here; the DOM half is pinned in a real browser by
// widget-host-avoid-browser.ts.
// Run: npx tsx scripts/test/widget-placement.ts
import {
  CLIMB_STEP,
  NEAR_CLIMB,
  chooseSlot,
  chooseTabTop,
  cornerEdges,
  resolvePlaceDirective,
  slotOrder,
  withSide,
  normalizePlacement,
  overlaps,
  toRect,
  DEFAULT_PLACEMENT,
  type Rect,
  type SlotVerdict,
  nearBandTop,
  cornerColumn,
  isCornerFloat,
  yieldCorner,
  type Corner,
} from "../../widget/placement";
import {
  normalizeWidgetPlacement,
  WIDGET_PLACEMENT_DEFAULT,
  WIDGET_CORNERS,
} from "../../src/config/widget-placement";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const rect = (left: number, top: number, w: number, h: number): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

// ---- overlaps ----
ok(overlaps(rect(0, 0, 10, 10), rect(5, 5, 10, 10)), "overlapping rects overlap");
ok(!overlaps(rect(0, 0, 10, 10), rect(20, 20, 5, 5)), "distant rects do not");
ok(
  !overlaps(rect(0, 0, 10, 10), rect(10, 0, 10, 10)),
  "touching edges do NOT count — a launcher flush beside another is fine",
);

// ---- cornerEdges ----
ok(
  cornerEdges("bottom-right").x === "right" && cornerEdges("bottom-right").y === "bottom",
  "bottom-right maps to right/bottom",
);
ok(
  cornerEdges("top-left").x === "left" && cornerEdges("top-left").y === "top",
  "top-left maps to left/top",
);
ok(
  cornerEdges("bottom-left").x === "left" && cornerEdges("bottom-left").y === "bottom",
  "bottom-left maps to left/bottom",
);
ok(
  cornerEdges("top-right").x === "right" && cornerEdges("top-right").y === "top",
  "top-right maps to right/top",
);

// ---- DOMRect shape: the bug every other assertion here missed ----
//
// The old avoidOffsetY cloned its input with `{...own}`. At runtime `own` is a
// DOMRect from getBoundingClientRect(), whose left/top/right/bottom are GETTERS
// ON THE PROTOTYPE — not own enumerable properties. The spread produced `{}`,
// every comparison became `undefined < number` (false), and the function
// silently concluded nothing was ever in the way. Auto-avoid did nothing in
// production while all 38 assertions above stayed green, because their fixtures
// are object literals and those spread perfectly.
//
// This fixture reproduces the real shape. It must behave identically to a plain
// object, so a future refactor cannot reintroduce a spread.
// Built with prototype getters and NO own properties, which is precisely what
// makes a real DOMRect spread to `{}`. A class with fields would not reproduce
// it — TypeScript turns those into own properties and the spread survives.
function fakeDOMRect(l: number, t: number, w: number, h: number): Rect {
  const proto = {
    get left() {
      return l;
    },
    get top() {
      return t;
    },
    get right() {
      return l + w;
    },
    get bottom() {
      return t + h;
    },
  };
  return Object.create(proto) as Rect;
}
const own = rect(1376, 836, 48, 48);
const chat = rect(1360, 820, 60, 60);
const ownDom = fakeDOMRect(1376, 836, 48, 48);
const chatDom = fakeDOMRect(1360, 820, 60, 60);

ok(
  Object.keys({ ...(ownDom as object) }).length === 0,
  "fixture is faithful: spreading it yields NO own properties, exactly like a real DOMRect",
);
ok(
  overlaps(toRect(ownDom), toRect(chatDom)) === overlaps(own, chat),
  "a getter-backed rect measures the SAME as a plain object — the prod bug",
);
ok(
  toRect(ownDom).bottom === own.bottom && toRect(ownDom).left === own.left,
  "toRect reads through prototype getters",
);
ok(probeCornerOverlapCheck(ownDom, chatDom), "overlaps() works on getter-backed rects too");
function probeCornerOverlapCheck(a: Rect, b: Rect): boolean {
  return overlaps(toRect(a), toRect(b));
}

// ---- normalizePlacement: total, never throws ----
ok(normalizePlacement(null).corner === "bottom-right", "null falls back to the default corner");
ok(normalizePlacement(undefined).autoAvoid === true, "undefined keeps auto-avoid on");
ok(
  normalizePlacement({ corner: "nonsense" }).corner === "bottom-right",
  "an unknown corner falls back",
);
ok(normalizePlacement({ corner: "top-left" }).corner === "top-left", "a valid corner is kept");
ok(
  normalizePlacement({ offsetX: -50 }).offsetX === 0,
  "negative offsets clamp to 0, never off-screen",
);
ok(normalizePlacement({ offsetX: 99999 }).offsetX === 240, "huge offsets clamp to the max");
ok(normalizePlacement({ offsetY: "24" }).offsetY === 24, "numeric strings coerce");
ok(normalizePlacement({ offsetY: NaN }).offsetY === DEFAULT_PLACEMENT.offsetY, "NaN falls back");
ok(normalizePlacement({ autoAvoid: false }).autoAvoid === false, "auto-avoid can be turned off");

// ---- the two normalizers must agree ----
// The widget cannot import from src/, so the logic exists twice. If they drift,
// the dashboard preview stops matching where the launcher actually lands.
ok(
  WIDGET_PLACEMENT_DEFAULT.corner === DEFAULT_PLACEMENT.corner &&
    WIDGET_PLACEMENT_DEFAULT.offsetX === DEFAULT_PLACEMENT.offsetX &&
    WIDGET_PLACEMENT_DEFAULT.offsetY === DEFAULT_PLACEMENT.offsetY &&
    WIDGET_PLACEMENT_DEFAULT.autoAvoid === DEFAULT_PLACEMENT.autoAvoid,
  "server and widget defaults are identical",
);
for (const c of WIDGET_CORNERS) {
  ok(
    normalizeWidgetPlacement({ corner: c }).corner === normalizePlacement({ corner: c }).corner,
    `server and widget agree on corner "${c}"`,
  );
}
for (const bad of [{ offsetX: -1 }, { offsetX: 5000 }, { corner: "nope" }, {}, null]) {
  const a = normalizeWidgetPlacement(bad);
  const b = normalizePlacement(bad);
  ok(
    a.corner === b.corner && a.offsetX === b.offsetX && a.offsetY === b.offsetY,
    `server and widget agree on ${JSON.stringify(bad)}`,
  );
}

// ---- slotOrder: the order IS the preference ----
{
  const base = { corner: "bottom-right" as const, offsetX: 16, offsetY: 16 };
  const slots = slotOrder(base, { edgeLength: 844, size: 40, lockSide: false });
  ok(
    slots[0].corner === "bottom-right" && slots[0].offsetY === 16,
    "the first slot is exactly the configured placement",
  );
  const firstMirror = slots.findIndex((s) => s.corner === "bottom-left");
  const firstFar = slots.findIndex((s) => s.offsetY > 16 + NEAR_CLIMB);
  ok(firstMirror > 0, "the mirrored corner is a candidate when the side is free");
  ok(firstMirror < firstFar, "the opposite corner is tried BEFORE climbing halfway up the edge");
  ok(
    slots.slice(0, firstMirror).every((s) => s.corner === "bottom-right"),
    "the preferred corner's near band comes first, whole",
  );
  ok(
    slots.every((s) => s.offsetY + 40 + 16 <= 844 || s.offsetY === 16),
    "no slot leaves the viewport",
  );
  ok(
    slots.every((s) => (s.offsetY - 16) % CLIMB_STEP === 0),
    "slots sit on the climb grid",
  );
  const maxY = Math.max(...slots.map((s) => s.offsetY));
  ok(maxY > 16 + NEAR_CLIMB, "a whole edge is reachable (a bottom sheet can be half the screen)");
  const locked = slotOrder(base, { edgeLength: 844, size: 40, lockSide: true });
  ok(
    locked.every((s) => s.corner === "bottom-right"),
    "a locked side (host directive / visitor choice) never jumps across the page",
  );
  const tiny = slotOrder(base, { edgeLength: 30, size: 40, lockSide: true });
  ok(
    tiny.length === 1 && tiny[0].offsetY === 16,
    "a viewport shorter than the launcher still yields the base slot",
  );
  const top = slotOrder(
    { corner: "top-left", offsetX: 8, offsetY: 8 },
    { edgeLength: 600, size: 40, lockSide: false },
  );
  ok(
    top.some((s) => s.corner === "top-right"),
    "top corners mirror along the top edge",
  );
}

// ---- chooseSlot: free beats surface beats layer beats hide ----
{
  const slots = slotOrder(
    { corner: "bottom-right", offsetX: 16, offsetY: 16 },
    { edgeLength: 844, size: 40, lockSide: false },
  );
  // A bottom sheet covering y-offsets < 400 on both sides, with controls
  // (blocked) in its bottom 100px: the first free slot is above the sheet.
  const sheet = (s: { offsetY: number }): SlotVerdict =>
    s.offsetY < 100 ? "blocked" : s.offsetY < 400 ? "layer" : "free";
  const pick = chooseSlot(slots, sheet);
  ok(
    pick !== null && pick.verdict === "free" && pick.slot.offsetY >= 400,
    "climbs past a sheet to a free slot",
  );
  const layerOnly = chooseSlot(slots, (s) => (s.offsetY < 100 ? "blocked" : "layer"));
  ok(
    layerOnly !== null && layerOnly.verdict === "layer" && layerOnly.slot.offsetY >= 100,
    "with no free slot, the first slot that covers only a layer (never a control)",
  );
  // substrata /atlas at 390: a sheet (layer) below, a pannable map (surface)
  // above. The map corner wins even though the sheet slots come first.
  const atlas = chooseSlot(slots, (s): SlotVerdict =>
    s.offsetY < 64 ? "blocked" : s.offsetY < 460 ? "layer" : "surface",
  );
  ok(
    atlas?.verdict === "surface" && atlas.slot.offsetY >= 460,
    "a surface (map) beats a layer (sheet content), whatever the order",
  );
  ok(chooseSlot(slots, () => "blocked") === null, "every slot on a control ⇒ hide, never cover it");
  {
    // heidi.orangecat.ch, 2026-10-09: the right corner is the site's own bar
    // (blocked), the left corner is body text, and the first free gap sits
    // mid-page. A launcher belongs in the corner, over the last line of a
    // paragraph, not floating beside a heading.
    const base = { corner: "bottom-right" as const, offsetX: 16, offsetY: 16 };
    const slots = slotOrder(base, { edgeLength: 844, size: 44, lockSide: false });
    const near = nearBandTop(base, { edgeLength: 844, size: 44 });
    const pick = chooseSlot(
      slots,
      (s) => (s.corner === "bottom-right" ? "blocked" : s.offsetY <= near ? "text" : "free"),
      near,
    )!;
    ok(
      pick.verdict === "text" && pick.slot.corner === "bottom-left" && pick.slot.offsetY === 16,
      "a near slot over plain text beats a free slot mid-page",
    );
    const sheet = chooseSlot(slots, (s) => (s.offsetY <= near ? "layer" : "free"), near)!;
    ok(
      sheet.verdict === "free" && sheet.slot.offsetY > near,
      "a near layer (a bottom sheet) still sends the launcher climbing",
    );
    const old = chooseSlot(slots, (s) => (s.offsetY <= near ? "text" : "free"))!;
    ok(old.verdict === "free", "without a band the old rule holds");
  }
  let calls = 0;
  chooseSlot(slots, () => (calls++, "free"));
  ok(calls === 1, "an empty corner costs exactly one measurement");
  const mirrorWins = chooseSlot(slots, (s) => (s.corner === "bottom-right" ? "blocked" : "free"));
  ok(
    mirrorWins?.slot.corner === "bottom-left" && mirrorWins.slot.offsetY === 16,
    "a blocked corner hands over to the mirrored corner at its base offset",
  );
}

// ---- withSide / resolvePlaceDirective: the host contract ----
ok(withSide("bottom-right", "left") === "bottom-left", "left keeps the bottom edge");
ok(withSide("top-left", "right") === "top-right", "right keeps the top edge");
ok(resolvePlaceDirective([null, undefined]) === null, "no declaration, no directive");
ok(resolvePlaceDirective(["left"]) === "left", "an <html> declaration applies");
ok(resolvePlaceDirective(["left", "hidden"]) === "hidden", "a region overrides <html>");
ok(resolvePlaceDirective([" RIGHT "]) === "right", "values are trimmed and case-insensitive");
ok(
  resolvePlaceDirective(["hidden", "sideways"]) === "hidden",
  "an unknown value is ignored, not guessed",
);
ok(resolvePlaceDirective(["tab"]) === "tab", "tab is a directive");
ok(resolvePlaceDirective(["hidden", "tab"]) === "tab", "a tab region overrides a hidden site");
ok(
  resolvePlaceDirective([null, "hidden", "tab"]) === "hidden",
  "an open dialog keeps the launcher off it even when a later region asks for the tab",
);
ok(
  resolvePlaceDirective([null, "host", "tab"]) === "host",
  "a host-drawn launcher outranks the tab a later region asks for",
);
ok(
  resolvePlaceDirective([null, "host", "hidden"]) === "hidden",
  "an open dialog still keeps the launcher off it when the host draws its own",
);
ok(resolvePlaceDirective(["host"]) === "host", "host may be declared site-wide on <html>");

// ---- chooseTabTop: the edge tab lands in the same place on every page ----
{
  const H = 800;
  const T = 64;
  const mid = Math.round(H * 0.5 - T / 2);
  ok(chooseTabTop(H, T, () => "free") === mid, "a clear edge: the tab sits in the middle");
  ok(chooseTabTop(H, T, () => "text") === mid, "text is not a reason to move");
  const tried: number[] = [];
  const top = chooseTabTop(H, T, (y) => {
    tried.push(y);
    return y === mid ? "blocked" : "free";
  });
  ok(top === Math.round(H * 0.42 - T / 2), "the middle blocked: the next height up");
  ok(tried[0] === mid, "the middle is always tried first");
  ok(
    chooseTabTop(H, T, () => "blocked") === mid,
    "every height blocked: still shown, in the middle — never missing",
  );
}

// ---- a corner holding the host's own floating button is the host's ----
{
  const phone = { width: 390, height: 760 };
  // substrata's ASK dock at 390px, and Heidi's "Practise / Ask Heidi" pill.
  ok(
    isCornerFloat(rect(305, 628, 65, 48), "right", phone),
    "an Ask button in the corner is a float",
  );
  ok(isCornerFloat(rect(141, 694, 233, 50), "right", phone), "so is a pill hugging the edge");
  ok(
    !isCornerFloat(rect(0, 696, 390, 64), "right", phone),
    "a tab bar spans the width: not a float",
  );
  ok(!isCornerFloat(rect(100, 300, 120, 48), "right", phone), "a centred box is nobody's corner");
  ok(!isCornerFloat(rect(305, 628, 65, 48), "left", phone), "a right float does not own the left");
  ok(!isCornerFloat(rect(0, 0, 0, 0), "right", phone), "an unrendered element is nothing");

  const col = cornerColumn(
    { corner: "bottom-right", offsetX: 16, offsetY: 16 },
    { width: 40, height: 40 },
    272,
    phone,
  );
  ok(
    col.left === 390 - 16 - 40 - 12 && col.right === 390 - 16 + 12 && col.bottom === 760,
    "the column is the launcher's own strip of the right edge, plus the gap",
  );
  ok(col.top === 760 - (272 + 40 + 12), "…up to the top of the near band");
  const top = cornerColumn(
    { corner: "top-left", offsetX: 16, offsetY: 16 },
    { width: 40, height: 40 },
    272,
    phone,
  );
  ok(top.left === 4 && top.top === 0 && top.bottom === 324, "a top-left column hangs from the top");

  const takenOnly =
    (...cs: Corner[]) =>
    (c: Corner) =>
      cs.includes(c);
  ok(
    JSON.stringify(yieldCorner("bottom-right", takenOnly(), false)) ===
      JSON.stringify({ corner: "bottom-right", yielded: false }),
    "a corner nobody holds: stay",
  );
  ok(
    JSON.stringify(yieldCorner("bottom-right", takenOnly("bottom-right"), false)) ===
      JSON.stringify({ corner: "bottom-left", yielded: true }),
    "the host's button in our corner: take the other one",
  );
  ok(
    yieldCorner("bottom-right", takenOnly("bottom-right", "bottom-left"), false) === "tab",
    "both corners held: the edge tab, never a tower",
  );
  ok(
    JSON.stringify(yieldCorner("bottom-right", takenOnly("bottom-right"), true)) ===
      JSON.stringify({ corner: "bottom-right", yielded: false }),
    "a side the host or the visitor named is kept",
  );
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
