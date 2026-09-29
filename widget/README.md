# Loki feedback widget — embedding it

The bundle every site loads as `<script src="https://loki.orangecat.ch/widget.js"
data-fc-project="fcw_…" async></script>`. Architecture, routes and history:
[`docs/architecture/feedback-widget.md`](../docs/architecture/feedback-widget.md).
This file is the part a HOST needs: installing it, what the panel offers,
where the launcher goes, and how to hide it.

## Installing

One tag, anywhere in the page. `async`, `defer`, a plain tag, a `type="module"`
tag, or one injected by a tag manager / `next/script` all work, and a page that
ends up with two copies of the tag still renders one launcher (all proven in
`scripts/test/widget-embed-browser.ts`).

## What the panel offers

| mode | `data-fc-modes` | what it is for |
|---|---|---|
| **Request a change** | `report` (default) | say what should change; it reaches whoever builds the site |
| **Ask Loki** | `ask` (default) | a second opinion first: "is this right, why is it like this, should it change, how would you make the site better?" — about a picked element, this page, or the whole site. Every change Loki recommends has **Request this →**, which opens Request a change prefilled with it |
| Chat | `chat` (opt-in) | the studio front desk (the Cat and Loki route visitors to projects) |

No attribute = `report,ask`. `data-fc-modes="report"` opts a site out of Ask.
Ask reads an outline of the page in the visitor's browser (headings, wording,
links, buttons, forms, a picked element's markup and computed style; for
"Whole site" a few more same-origin pages from the navigation) and sends it to
`/api/widget/advise`, charged to the token owner's AI budget. It sees no
pixels and is told to say so.

## "Watch the fix" — the walkthrough

When a fix has shipped, Loki's feedback row offers **Watch the fix**. It opens
the live page with `#loki-tour=<token>` (a signed, 24-hour ticket for that one
report, carried in the fragment so the site's server never sees it). This
bundle reads a numbered outline of the visible page, asks `/api/widget/tour`
for a script, and plays it: a cursor glides to each element, a caption says
why, and in-page controls (an `#anchor` link, a disclosure, a plain button)
are really clicked — anything that would navigate away or submit is only
pointed at. A step it cannot show is said out loud ("Oops — …, it has been
flagged") and reported back; Loki files it as an AI-review item on the
project, so a fix that is not really live comes back into the loop. Nothing
for a host to install: every site with the widget gets it. Code:
`widget/tour.ts`, `src/app/api/widget/tour/route.ts`,
`src/lib/feedback/tour-plan.ts`.

## Where the launcher sits

Nothing to configure for the common case. On load, on resize, after any scroll
(including inner panels), on SPA navigation and on DOM changes (throttled to one
pass a second) the launcher measures its candidate slots and takes the best:

1. the configured corner (operator placement from boot; default bottom-right,
   16px), climbing its edge up to 260px;
2. the mirrored corner on the same edge, same band;
3. the rest of each edge.

Each slot is hit-tested over the launcher plus a 12px gap and judged:

| verdict | what is under it | used |
|---|---|---|
| free | nothing of yours that matters (background, margin) | first one wins |
| text | in-flow words — nothing to click, but someone is reading them | only if no slot is free |
| surface | a corner of a control ≥ 25% of the viewport — a pannable map, a canvas, a card-sized link | only if no free or text slot |
| layer | a fixed/sticky bar, a bottom sheet, an inner scroll panel (anything < 60% of the viewport) | only if nothing better |
| blocked | any control a visitor could click — links, buttons, inputs, `[role=button]`, `[tabindex]`, iframes, `cursor:pointer` — or anything marked `data-fc-avoid` | never |

If every slot is blocked the launcher **hides** until the page changes; a
launcher that eats a click is worse than none. `window.Loki.report()` still
works for a host that wires its own "Report" control.

## The host contract — for what the heuristics cannot see

| attribute | where | effect |
|---|---|---|
| `data-fc-avoid` | any element | never overlap it (checked by rectangle too, so it works on `pointer-events:none` overlays) |
| `data-fc-place="left"` / `"right"` | `<html>` or any rendered page region | keep the launcher on that side (it may still climb that edge) |
| `data-fc-place="hidden"` | `<html>` or any rendered page region | no launcher while that region is rendered — e.g. a checkout or a full-screen editor |

`<html>` sets the site default; a rendered region overrides it (the last one in
document order wins). A region that is `display:none` or unmounted says nothing,
so a route can carry its own directive and the launcher returns when it leaves.

Legacy, still honoured: `data-fc-bottom="N"` on the script tag sets the base
bottom offset. The operator's placement (corner, offsets, auto-avoid on/off) is
set per token in Loki and served by `/api/widget-boot`; `autoAvoid: false`
switches the measuring off but `data-fc-place` still applies.

## Hiding it

| who | how | undo |
|---|---|---|
| the operator, everywhere | pause the token on the project's Widget card (seconds, no deploy) | un-pause |
| the host, on a route | `data-fc-place="hidden"` (above) | route leaves |
| a visitor, for themselves | **Hide this button on this site** at the foot of the panel, or long-press / right-click the launcher → *Hide on this site* | the toast's **Undo**; later, open any page with `#loki` at the end of the address |

A visitor's hide is remembered per site in their browser. It never disables
the page's own API: `window.Loki.report()` / `ask()` still open the panel (and
bring the launcher back), and `window.Loki.show()` restores it — so a host's own
"Report" link keeps working for someone who hid the button. Visitors can also
move it to another corner from the same long-press / right-click menu.

## Tests

- `scripts/test/widget-embed-browser.ts` — installing (module / injected /
  duplicate tags), hiding and every way back, and Ask → Request this.
- `scripts/test/widget-advise.ts` — the advisor prompt, answer/changes split,
  and the widget↔route caps.
- `scripts/test/widget-placement.ts` — the pure slot order and chooser.
- `scripts/test/widget-host-avoid-browser.ts` — real Chromium fixtures (bottom
  sheet under the launcher, composer Send, a host Ask button, map + sheet,
  `data-fc-avoid`, `data-fc-place`, late-mounted sheet, a wall of controls).
  Mutation-proven against the pre-fix bundle: `WIDGET_JS=<old bundle>` fails 7.
