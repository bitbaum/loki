# Loki feedback widget — embedding it

The bundle every site loads as `<script src="https://loki.orangecat.ch/widget.js"
data-fc-project="fcw_…" async></script>`. Architecture, routes and history:
[`docs/architecture/feedback-widget.md`](../docs/architecture/feedback-widget.md).
This file is the part a HOST needs: installing it, what the panel offers,
where the launcher goes, and how to hide it.

## Voice notes while browsing

Open Loki and tap **Talk** in the composer — the panel's one microphone. The
owner need not open Loki at all: a microphone sits INSIDE their launcher pill
(`widget/quick-talk.ts`; one outline, one footprint, grabbed and dragged like the
pill; never on the edge tab, never when the host draws the launcher, never for a
visitor — never alone), and one tap on it starts recording. The
panel closes; one dock — *● Recording 0:12 · Mark · Done · ✕* — and a red edge
round the whole screen say Loki is listening, and the site stays usable (the
edge takes no taps). Scroll and tap and talk. Loki notes which part of the page is in view (its nearest
heading), the text at the reading line, how far you have scrolled, and
anything you tap on the site (the control's own label, never what you typed)
— when you start, the moment the site moves to another page, each time
scrolling settles, each time you tap, and each time you tap **Mark**
("Marked “Pricing”"). No video: a page cannot film itself
on a phone without a permission prompt. Instead the structured moments travel
with the note (`widget/moments-contract.ts`), and in Loki the owner taps "See
what they saw" on any moment to have Loki open that very view and take the
picture itself. A take is capped at 1:50 by the upload limit, but a walk is
not: at the cap the recorder hands straight into the next take (up to ten,
about eighteen minutes) and the clock keeps counting.

**Done** writes it down. Whisper says when each sentence was said, so the note
comes back with each sentence under the part of the page that was in view
when it began — whole sentences, never cut where Whisper paused (`wholeSentences`;
2026-10-18 a sentence was split across two headings as the page scrolled)
(`widget/voice-moments.ts`, tested in `scripts/test/widget-voice-moments.ts`):

    On “Nutzen”:
    This card is empty, there should be a picture.

    On “Unterstützen” (marked):
    Is the shop open?

The card first says what Loki heard — *Loki heard you · 0:43 across 4 pages*
— and then Loki **reads** it the way a person would listen
(`widget/walk-read.ts`, `POST /api/widget/understand`): *Here is what Loki
heard* — a list, one thing per line, each a **Change** or a **Question** with
where it applies (*Contact section*, *Home page, signed in*, *Whole site*), its
words editable and ✕ to drop it. People talk freely while they scroll, so the
part on screen is background: a line names a part only when they pointed at it
(Mark, a tap, "this", or its name). **Save 2 changes** files each change as its
own note, with the moments it came from, on the page it was said on — so each
is built on its own, and the owner's saved notes build page by page; questions
stay on the card for **Ask**. What was said but not meant for
Loki (to someone in the room, or narrating the clicks) is named under it as
*Left out*; the words as spoken stay under **Word for word**, with **Use my
exact words instead**. Only questions lead with **Ask Loki**, answered about
every page of the walk, not only the open one; changes lead with **Save** for
the owner (then **Fix it now**) and **Save feedback** for a visitor. Nothing waits on the read: while it comes, and if it
fails, the card is the words as spoken with the buttons as before, and words
edited before it arrives are never replaced. Whatever is saved, the words as
spoken travel with it in each moment's `said`. The card never sends by itself. The whole note is kept — the receipt quotes a short note whole and
otherwise names it ("Saved your 3 changes."), with the note under it, one
change per line, clamped to whole lines with **Show all** — never a sentence
cut at the panel's edge.

The original location stays attached even if you move before sending. Unsent
transcripts survive same-tab page loads. Finish recording before following a
full-page link: audio cannot continue through navigation.

See [capture design and limits](../docs/development/contextual-voice-feedback.md).

## Who is the owner here

Under the greeting, **This is my site — sign in with Loki →** says who it is
for and what happens, goes through Loki's sign-in and lands back on the page.
Whoever owns the site's Loki project, and anyone it is shared with as an
editor, gets the owner's panel (Watch, Fix it, Your changes) —
`src/lib/feedback/pass-holder.ts`, one rule for every route. No Loki account:
"Create one free" keeps the way back to the site. Signed in as someone else:
the panel says this site belongs to another account, and they can still chat
and save feedback as a visitor.

## The design, in one model

Read this before changing the widget; every rule below was learned by using it.

**One conversation, clear intents.** The panel opens ready to **Ask**. Beside
it, **Save feedback** for a visitor or **Fix it** for a verified owner — two
words for two intents; the long labels made the composer read like a form. This is not a model selector: the same
Loki conversation handles the question, note and follow-up, and approved work
uses the project's existing builder queue.

**Two ways to say anything, side by side.** *Save feedback* (straight to the
builder, no AI, never waits on a model) and *Ask* (a second opinion
first). Anything Loki suggests is one tap from the builder. What was sent comes
back as a receipt in the same thread, linked to where it can be followed in
Loki. The box's placeholder says what the message is about.

**Context stays simple.** The current page is the default. A compact scope menu
can change the message to the whole site or Loki itself; **Point to area** is
always one tap away. On a phone the widget becomes a full-width bottom sheet;
on desktop it stays a compact panel.

**One Loki identity.** The fallback view does not repeat Loki's name above every
answer. The panel header names who is speaking, and the shared chat keeps its
usual assistant behavior.

**Theme follows Loki.** The widget uses generated light/dark variants from the
same design tokens as the app. Embedded sites can set `data-fc-theme="light"`
or `"dark"`; otherwise the browser appearance is followed. Loki's own embed
passes the active app theme directly.

**Few controls, each said once.** The owner's panel starts with ONE line — *●
Watching · 11 changes need you › Pause ✕* — which is the header: it opens what
Loki noted and where each change is. Then the conversation, and the composer
(*Talk · screenshots · Fix it · Ask*). The line carries ONE number: what waits
on the owner's decision — changes said and not saved yet, saved notes and notes
not started, failed attempts — counted over all of the owner's changes, not the
newest twelve; with nothing waiting it says just *Watching*. Opened, the list
shows every one of those rows first, each one tap from acting on it. It was two status rows, two microphones and a
footer before a word was said (owner, 2026-10-17: "too intimidating"), and then
a brand row, the page name and "Watching · 4 to look at · 11 needs you" — three
rows and two unnamed numbers (2026-10-18). A visitor's panel keeps the brand
row and the page name: there they say whose this is and what it is about.
*Continue in Loki* appears once there is something to take.

**Typing on a phone is one state, however the keyboard is drawn.** A focused
text box in the sheet makes it fill what is visible and step the extras aside
(`widget/sheet.ts`). Keyboard insets alone missed every page that shrinks for
the keyboard (`interactive-widget=resizes-content`, Loki's own): the sheet kept
68% of a viewport already halved and the thread was a one-pixel sliver.

**Record now, build later.** While Loki watches, **Talk**, scroll, **Done**: the
owner's note card leads with **Save** (then *Fix it now*, *Ask*). Saved notes
collect on the status line — *Watching · 3 changes need you ›* — and one tap,
**Build all 3 saved notes**, starts them as one build per page, in the order
they were said — a page's notes are fixed together, in one pass that sees
them all (`groupNotesByPage`; a lone note builds on its own)
(`POST /api/widget/owner/build`, `src/lib/feedback/saved-notes.ts`; same owner
check as Your changes, `src/lib/widget/owner-request.ts`).

**One widget, everywhere.** Every site — Loki's own included — draws the same
panel (Loki's own embed used the chatkit view and read as a different product,
2026-10-18). The launcher has two shapes and both say the owner's state: the
corner pill, or the edge tab with the same live dot. The owner's pill sits in a
bottom corner or becomes the tab; it never climbs to the middle or top of the
screen. No page hides it except an open dialog and a sign-in wall
(`scripts/test/feedback-widget-reach.ts` fails on any other). On a phone, Loki's
own app asks for the tab on every page (its bottom bar carries
`data-fc-place="tab"`): the pill floated over Control's cards above that bar. An
open dialog still wins over a later region's tab (`resolvePlaceDirective`).

**Watch is the owner's, and it speaks.** While it watches, Loki says what it
noticed — in the conversation, in plain words, naming the tap that led there,
each with *Fix this* and *Why does it matter?* — and is otherwise quiet.
A finding is said once: a page's checks own ONE card, which each new reading
updates in place (and a clean reading takes back), so the same finding never
stacks (`widget/thread.ts` `pushNoticed`). The checks measure only what is
rendered, once the page has held still, twice, and say only what both
readings agree on — a page caught swapping screens once read "no main title"
and "2 main titles" at the same time (`settledPageChecks`,
`scripts/test/widget-page-checks-browser.ts`). A fix Watch starts is said as it
stands: "I've started a fix" becomes "the fix I started did not finish", with
**Open it in Loki to see why →** — a link to that run's Watch page.

Rules that resolve the trade-offs:

- **The launcher is the status, and the owner has exactly one of it.** For a
  visitor it is quiet ("quiet until wanted"). For the owner it is full weight —
  ONE button that says its state in a word at every width, *● Watching* or
  *Paused*, with a count of what Loki said while the panel was closed and the
  newest remark beside it. A tap opens Loki. (It had a second half, **Point**,
  which on a phone was the labelled, bigger part — so the obvious tap pointed
  instead of opening, and the state was a turning spiral nobody read,
  2026-10-17. Pointing is **Point to area** in the composer.) Auto-avoid
  measures the button and its unread badge. The owner pill only uses clear space
  in a bottom corner; elsewhere it becomes the edge tab, which keeps the live
  dot, the unread count and access to the conversation. Remark previews only appear
  over clear space and dismiss on scroll or when space becomes occupied; every remark remains
  in the conversation. The top bar exists only for a page that
  hides the launcher outright (`data-fc-place="hidden"`; the edge tab counts as
  shown), and carries its own
  **Point** — the owner said on 2026-10-10 that a bar and a launcher taking turns
  "sure is confusing", and they were right.
- **Starting and stopping is one tap**, named for what it does (*Stop
  watching*, *Watch again*), in the conversation and wherever the status shows.
  Stopped means nothing is recorded and nothing is said.
- **Precision over coverage.** A remark that is wrong teaches the owner to
  ignore Loki. Checks follow the standard they cite (WCAG's spacing exception
  for small targets), read what a screen reader reads (not what happens to be
  painted), and every rule has a browser test that would fail if it cried wolf.
- **Speaking up costs nothing.** Remarks are written by rules, once per visit;
  a model runs only when asked (*Why*, *Review*, *Ask Loki*).
- **The bundle is ASCII.** The widget runs on pages that may not declare an
  encoding. esbuild escapes non-ASCII characters in strings but keeps them raw
  inside regex literals, where the browser can read them as other characters
  and nothing matches. Write `\u2014`, not `—`, in a regex.
  `scripts/test/widget-ascii-bundle.ts` fails on any non-ASCII byte in the
  built bundle.
- **Never move what someone is reaching for.** New messages follow only when
  you were already at the bottom; reading further up, your place is kept.
- **Send is always reachable.** Only the thread scrolls; the composer never
  does, and a tap on Send must HIT Send — measured with `elementFromPoint` at
  real heights (390×667, 360×640, 1280×720) in both browser suites, and by
  self-watch on every open. Production broke this on 2026-10-17 at heights no
  test used: a tap on Send opened "Made with Loki" instead.
  When the room runs out, the thread gives way first, then the starter chips
  (one swipe row on a phone), never the composer. The suites also assert the
  causes on phones — starters one row, footer one line ("Made with Loki →") —
  because a fixture once reached Send while orangecat.ch at 390×667 did not.
- **Fits on a phone, with a mic.** The panel must never scroll sideways at
  320–1200px with every control present (a composer tested without a mic once
  pushed *Ask Loki* out of the panel).

## Installing

One tag, anywhere in the page. `async`, `defer`, a plain tag, a `type="module"`
tag, or one injected by a tag manager / `next/script` all work, and a page that
ends up with two copies of the tag still renders one launcher (all proven in
`scripts/test/widget-embed-browser.ts`).

## What the panel offers

The composer starts in **Ask**. Choose **Save feedback** to file a
visitor note, or **Fix it** when you are signed in as the site owner.
The current page is already selected; open the scope menu only when the note
is about the whole site or Loki. **Point to area** attaches the element you
select. Recommendations can be sent into the project's builder queue, and the
receipt stays in the conversation.

Watching and site review are owner-only. Visitors do not see a Watch control;
the owner sign-in link sits under the greeting where its purpose is clear.
Owners see the current watch state and can pause, resume, or review the visit.
Loki narrates observed problems in the same conversation, with **Fix this** and
**Why does it matter?**. Rule-based checks speak up without a model; a model
runs only when the owner asks Loki to review the session.

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
attached, for anything that looks wrong without failing. **Point to area** —
in the composer — is how the owner shows Loki something: tap it, then tap the
element, or **This screen** to mark everything on screen right now (the blocks
a screenshot would frame), and say what you would change. Loki answers or
builds it, in the same conversation. **Pause** on the pill stops recording until **Resume**;
visitors without the pass get no pill and no recording.
Code: `widget/watch.ts` (page), `widget/watch-trail.ts` (pure, tested);
proven in a browser by `scripts/test/widget-watch-browser.ts`.

## The widget on itself

The widget is part of Loki, so what is wrong with the WIDGET goes to Loki,
not to the site. Two ways:

- **About: Loki itself** — a fourth chip in the composer. "This panel covers
  my keyboard" (with a screenshot, if you like) goes to Loki's own project —
  the one `FEEDBACK_WIDGET_TOKEN` belongs to, where the dogfood widget and a
  thumbs-down on a Loki answer already land — never to whoever builds the site.
- **Self-watch** (owner, while watching): the widget's own errors, its own
  calls to Loki failing or taking more than 20s, and a panel that does not fit
  the screen it opened on are filed there automatically, once per kind per
  tab, and said in the conversation in one line ("About me, not this page…")
  so the owner knows it went somewhere. Only the owner's browser speaks
  unasked — a visitor never agreed to that. A 4xx from Loki is Loki answering
  on purpose and is not a defect. Reads the widget repeats on its own (the
  changes poll, the boot check) count only after three failures in a row, and
  a request that lived through the page being put away (a phone locking) is
  never one: "I couldn't check on your changes just now" was said for one
  dropped poll (2026-10-20).

**Loki improving Loki.** When the person is Loki's *own* owner — using Loki's
widget on one of their sites — a note about the widget, a crash, or a panel
that did not fit starts a fix on the spot, the same way an owner's note on
their own site does ("the owner's word is the decision"): one agent builds it
into Loki, the PR merges and deploys itself, and the receipt in the thread
says "On it" with *Follow the build →*. A slow or failed call to Loki only
files (it may be the network's bad minute); its duplicate count is the signal.
Anyone else's report waits in Loki's inbox for that owner to start.

Code: `widget/self-watch.ts` (what counts), `widget/self-report.ts` (the
POST), `src/lib/widget/self-report.ts` + `src/app/api/widget/self-report/route.ts`
(the words and the row). `scripts/test/widget-self-report.ts` holds both sides
to the same caps.

The owner's top bar also steps aside while the site has a modal open (a
`<dialog>` shown modally, or `aria-modal`): it used to sit on top of the
sheet's own title.

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

**A corner holding the site's own floating button is the site's.** When a
compact fixed control hugs the configured corner's edge within that 260px band
(an Ask button, a chat bubble, a "Practise / Ask" pill — not a full-width tab
bar or composer), the launcher does not climb above it: two assistants stacked
read as one odd tower (substrata, 2026-10-17). It takes the mirrored corner if
that has a free or text slot, and the edge tab otherwise. A side named by
`data-fc-place` or chosen by the visitor is kept regardless.

If every slot is blocked the launcher becomes the **edge tab** — a slim handle
flush against its side edge, in the middle, or the nearest height that covers
no control — until a corner clears. It used to hide instead, and from the
outside that read as "sometimes it is there, sometimes not". The rule now: the
launcher is on screen, as the corner button or the edge tab, unless someone
switched it off (see *Hiding it*). Owners use the edge tab too when no clear
space fits the whole pill.

## The host contract — for what the heuristics cannot see

| attribute | where | effect |
|---|---|---|
| `data-fc-avoid` | any element | never overlap it (checked by rectangle too, so it works on `pointer-events:none` overlays) |
| `data-fc-place="left"` / `"right"` | `<html>` or any rendered page region | keep the launcher on that side (it may still climb that edge) |
| `data-fc-place="tab"` | `<html>` or any rendered page region | the edge tab instead of the corner button while that region is rendered — for pages whose corners are busy (Loki's Terminal and chat use it) |
| `data-fc-place="hidden"` | `<html>` or any rendered page region | no launcher while that region is rendered — e.g. a checkout. The host's off switch: give people another way in (`Loki.report()`) |
| `data-fc-place="host"` | the host's own launcher element | the host draws the launcher: no floating button while that element is rendered, and the owner's state counts as shown (watch mode adds no bar). The element calls `window.Loki.open()` and shows `window.Loki.status` (`{ owner, watching, unread }`, changes announced as a `loki:status` event on `window`). If the element is hidden — an immersive page drops the bar it sits in — the launcher comes back by itself. Loki's own top bar uses it; a `hidden` region still wins |

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
| anyone, to make it small without losing it | long-press / right-click the launcher → **Minimize**: the pill (its microphone and remark bubbles with it) folds into the slim edge tab, on the side and at the height they left it, still one tap from Loki and still showing the live dot and the unread count | long-press / right-click the tab → **Expand**. Remembered per site in their browser; a minimized launcher outranks every placement heuristic (`widget/launcher.ts`, `scripts/test/widget-host-avoid-browser.ts` 8d) |
| the host, as a switch for its people | `window.Loki.hide()` / `window.Loki.show()`, state in `window.Loki.hidden`, changes announced as a `loki:visibility` event on `window` (Loki's account menu: *Hide / Show feedback button*) | `Loki.show()` |

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
  `data-fc-avoid`, `data-fc-place` (left, tab, hidden), late-mounted sheet, a
  wall of controls → edge tab, and the `Loki.hide()`/`show()` switch).
  Mutation-proven against the pre-fix bundle: `WIDGET_JS=<old bundle>` fails 7.
