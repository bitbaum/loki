# Loki feedback widget — embedding it

The bundle every site loads as `<script src="https://loki.orangecat.ch/widget.js"
data-fc-project="fcw_…" async></script>`. Architecture, routes and history:
[`docs/architecture/feedback-widget.md`](../docs/architecture/feedback-widget.md).
This file is the part a HOST needs: installing it, what the panel offers,
where the launcher goes, and how to hide it.

## The design, in one model

Read this before changing the widget; every rule below was learned by using it.

**Two people, one place.** A *visitor* wants to tell whoever builds the site
something, quickly, and know it arrived. The *owner* wants an expert looking
over their shoulder: say what is wrong, get it fixed. Both get the same thing —
**one conversation with Loki** — so there is one place to look and one way of
doing everything; no tabs, no second tool.

**Two ways to say anything, side by side.** *Send as feedback* (straight to the
builder, no AI, never waits on a model) and *Ask Loki* (a second opinion
first). About *this page / the whole site / an element* scopes both. Anything
Loki suggests is one tap from the builder. What was sent comes back as a
receipt in the same thread, linked to where it can be followed in Loki.

**Watch is the owner's, and it speaks.** While it watches, Loki says what it
noticed — in the conversation, in plain words, naming the tap that led there,
each with *Fix this* and *Why does it matter?* — and is otherwise quiet.

Rules that resolve the trade-offs:

- **The launcher is the status, and the owner has exactly one of it.** For a
  visitor it is quiet ("quiet until wanted"). For the owner it is full weight —
  one pill, two halves: *Loki · watching* (a count of what Loki said while the
  panel was closed, the newest remark beside it) and **◎**, which points at an
  element or marks the whole screen. The owner's launcher never hides for the
  auto-avoid and never fades on scroll: on their own site, a corner it covers
  is theirs to move it from (long-press), not a reason for it to vanish and
  something else to appear at the top. The top bar exists only for a page that
  hides the launcher outright (`data-fc-place="hidden"`), and carries the same
  ◎ — the owner said on 2026-10-10 that a bar and a launcher taking turns
  "sure is confusing", and they were right.
- **Starting and stopping is one tap**, named for what it does (*Stop
  watching*, *Watch again*), in the header and wherever the status shows.
  Stopped means nothing is recorded and nothing is said.
- **Precision over coverage.** A remark that is wrong teaches the owner to
  ignore Loki. Checks follow the standard they cite (WCAG's spacing exception
  for small targets), read what a screen reader reads (not what happens to be
  painted), and every rule has a browser test that would fail if it cried wolf.
- **Speaking up costs nothing.** Remarks are written by rules, once per visit;
  a model runs only when asked (*Why*, *Review*, *Ask Loki*).
- **Never move what someone is reaching for.** New messages follow only when
  you were already at the bottom; reading further up, your place is kept.
- **Fits on a phone, with a mic.** The panel must never scroll sideways at
  320–1200px with every control present (a composer tested without a mic once
  pushed *Ask Loki* out of the panel).

## Installing

One tag, anywhere in the page. `async`, `defer`, a plain tag, a `type="module"`
tag, or one injected by a tag manager / `next/script` all work, and a page that
ends up with two copies of the tag still renders one launcher (all proven in
`scripts/test/widget-embed-browser.ts`).

## What the panel offers

One conversation with Loki. **About: This page · Whole site · An element**
says what you mean; then write (or speak, or paste a screenshot) and choose:
**Send as feedback** goes straight to whoever builds the site, **Ask Loki**
gets a second opinion first. Every change Loki recommends has **Send to
builder →** too. The confirmation and the receipt (with a link to track it)
appear in the conversation, which is kept per tab so it survives page loads.

**Watch** sits in the header. Anyone not yet known as the owner gets "This is
my site — sign in with Loki", which comes straight back with Watch on. While it
watches, a bar at the top says so, Loki **speaks up in the conversation** when
something does not work or does not look right (a failed request, a frozen
page, content jumping, unlabelled buttons, broken images — each in plain words,
with **Fix this** and **Why does it matter?**), and **Stop watching** is one
tap in the header or the bar. Speaking up is rule-based; a model only runs on
Why or Review.

`data-fc-modes` only decides who answers:

| `data-fc-modes` | who answers |
|---|---|
| (none) / `report,ask` | Loki, about this site |
| `chat` | the studio front desk — the Cat and Loki route visitors to projects |
| `report` | nobody: no AI, a message goes straight to the send confirmation |

The site's owner always gets Loki's advice, whatever the attribute says.
Loki reads an outline of the page in the visitor's browser (headings, wording,
links, buttons, forms, a picked element's markup and computed style; for
"Whole site" a few more same-origin pages from the navigation) and sends it to
`/api/widget/advise`, charged to the token owner's AI budget. It sees no
pixels and is told to say so.

## Watch mode — the owner's site fixes itself

Open your site from Loki (**Open your site** on the project page). That link
carries the owner pass, and from then on, in that browser, a pill at the top
of the page says **Loki is watching**. While it does, the widget keeps a short
trail — pages, taps (by the control's label, never what was typed), the site's
own non-GET requests — and when the page breaks (an uncaught error, a request
that fails with a 5xx or never answers, or a button or link tapped three
times in five seconds with nothing happening) it files a report with that
trail. The
owner pass makes the report a build, so the pill turns into **Something broke
— Loki is fixing it · Follow**. One report per distinct cause, at most three
per page load. **Report** on the pill opens the note with the same trail
attached, for anything that looks wrong without failing. **◎** — on the
launcher, always — is how the owner shows Loki something: tap it, then tap the
element, or **This screen** to mark everything on screen right now (the blocks
a screenshot would frame), and say what you would change. Loki answers or
builds it, in the same conversation. **Pause** on the pill stops recording until **Resume**;
visitors without the pass get no pill and no recording.
Code: `widget/watch.ts` (page), `widget/watch-trail.ts` (pure, tested);
proven in a browser by `scripts/test/widget-watch-browser.ts`.

## "Watch the fix" — the walkthrough

When a fix has shipped, Loki's feedback row offers **Watch the fix**. It opens
the live page with `#loki-tour=<token>` (a signed ticket for that one report,
carried in the fragment so the site's server never sees it). This bundle reads
a numbered outline of the visible page, asks `/api/widget/tour` for the story,
and plays it in chapters: the report (with the reporter's screenshot, if they
attached one), what was wrong, the change demonstrated live, why this way, what
else was considered, who it helps. On the page, a cursor glides to each
element and in-page controls (an `#anchor` link, a disclosure, a plain button)
are really clicked; anything that would navigate away or submit is only
pointed at. Back, Pause and Next put the pace in the viewer's hands.

The story comes from the **design note** the agent writes in the fix's pull
request (`## Walkthrough`, `src/lib/feedback/fix-note.ts`). A PR without one
still gets a walkthrough, built from the report and the agent's one-line
account.

The ticket has an **audience**. The owner's (24 hours, minted from Loki) gets
the whole story and ends at "confirm in Loki" and the PR. The reporter's
(seven days, minted on `/my-feedback` once the fix is live) gets their own
words, the live demonstration and the note's plain sentence — never the
maintainer's reasoning, the PR or the repository. That boundary lives in
`buildTourBeats` (`src/lib/feedback/tour-plan.ts`) and nowhere else.

A step it cannot show is said out loud ("Oops — …, it has been flagged") and
reported back; Loki files it as an AI-review item on the project, so a fix
that is not really live comes back into the loop. Nothing for a host to
install: every site with the widget gets it. Code: `widget/tour.ts`,
`src/app/api/widget/tour/route.ts`, `src/lib/feedback/tour-plan.ts`,
`src/lib/feedback/fix-note.ts`, `src/lib/feedback/tour-token.ts`.

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
  duplicate tags), hiding and every way back, the one conversation (ask →
  send to builder → receipt, surviving a reload), the Watch offer's sign-in
  link, and the report-only embed.
- `scripts/test/widget-thread.ts` — who answers, restoring a stored thread
  (untrusted input), the thread as model history.
- `scripts/test/widget-advise.ts` — the advisor prompt, answer/changes split,
  and the widget↔route caps.
- `scripts/test/widget-placement.ts` — the pure slot order and chooser.
- `scripts/test/widget-host-avoid-browser.ts` — real Chromium fixtures (bottom
  sheet under the launcher, composer Send, a host Ask button, map + sheet,
  `data-fc-avoid`, `data-fc-place`, late-mounted sheet, a wall of controls).
  Mutation-proven against the pre-fix bundle: `WIDGET_JS=<old bundle>` fails 7.
