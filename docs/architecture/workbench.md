# Workbench: one project, side by side, on one screen or two

**Created:** 2026-10-30

A project's builder (Session) and what it is doing (Watch) as columns of
one window, one box between them, and the site in a window of its own —
beside it, or on the other screen. Route:
`/projects/[id]/workbench`; code: `src/components/workbench/`,
`src/lib/workbench/`, `src/config/workbench.ts` (the pane SSOT),
`desktop/src/main/workbench-windows.ts`.

## What it is for

Build something, use it, and say what to change without leaving the screen
it is on. The widget on the site already does the saying — pointing at an
element, a voice note while scrolling, "Fix it now" for the owner — the
Sessions page already has the builder and its box, and the Watch page
already shows the build as it happens: what was asked, Loki narrating, the
agent's screen, and where the change is (merged, deploying, live). The
workbench is the arrangement: those two side by side, and the site where a
second screen or a second window puts it. Nothing in it is new UI. The
columns are `TerminalSurface` and `ProjectWatch`, mounted as they are; the
site is the live page with the owner's pass in the fragment
(`lib/feedback/owner-pass.ts`).

## One box

The first cut put Loki's chat in the second column. Beside the session's
box that was a second place to type on one screen, and a person had to work
out which box did what (owner, 2026-10-30: "I see two chats, and it just
gets confusing"). The session's box already does the one thing the screen
is for — it types into the live agent, or starts one — and the session
already offers Loki about itself ("What's going on?", the rail). So the
second column is what the builder is DOING, which has no box, and Loki's
chat stays its own page. One screen, one box.

## Why the site is a window and not a pane

Every fleet site answers with `frame-ancestors 'none'`, `X-Frame-Options:
DENY` and `Cross-Origin-Opener-Policy: same-origin`
(`scripts/site-template/lib/security.ts`, synced from bitbaum/fleet). The
first two mean a site cannot be an `<iframe>` in Loki; the third means a
site opened with `window.open` severs `window.opener`, so Loki cannot reach
it with `postMessage` either, and cannot even tell whether that window is
still open. Those headers are right for a public site, and they are not
Loki's to weaken from here.

So the site is a top-level window, and the workbench never pretends to know
more about it than it does: "Open the site" opens it (or brings it forward
where the platform can), placed where the person asked, and that is the
whole relationship. What the person does there reaches Loki the way it
always has — through the server, as a note, a voice walk or a change — and
the Session column shows the build start by itself.

A second slice can carry a pointed-at element from the site straight into
the session's box. The transport for that is the server (the widget
already talks to `/api/widget/*`; the app already streams a project's
events), never the browser's window relationships. It is not built yet.

## Windows and where they go

`lib/workbench/windows.ts` opens a window — a pane of Loki's own, or the
site — in the best way the platform offers, in this order:

1. **Fleet Runner.** The desktop app's main window sends every
   `window.open` to the default browser (`desktop/src/main/index.ts`, the
   window-open handler), so inside it the workbench asks through the bridge
   (`window.fleetRunner.openWorkbenchWindow`, v0.8.60+). The main process
   reads the real display list, puts the window on the other display or
   tiles this one (caller left, new window right; the shell keeps its
   800px minimum and the new window takes the rest), and a window already
   open is restored, placed where the person now asks and brought forward
   instead of opened twice.
2. **A browser with the Window Management API** (Chromium) names the other
   screen once the person allows it, and the popup is placed there. The
   permission prompt is raised when "On the other screen" is chosen, not
   on the open that follows: a click that waits for a prompt goes stale,
   and the browser then refuses the window as unasked-for.
3. **Any browser:** a popup sized to half this screen, left for the person
   to drag. A window this page already opened is brought forward, never
   navigated again (the site's address carries a fresh pass each visit,
   which a second navigation would leave unread in the address bar). A
   refused window is said on the page, not swallowed.

The placement arithmetic is one pure module both sides share,
`src/lib/workbench/placement.ts`, tested in
`scripts/test/workbench-placement.ts`.

Where new windows go — beside, or the other screen — is one choice in the
strip, remembered on this device, and the same choice drives the site and
every popped-out pane (`hooks/use-workbench-windows.ts`). Fleet Runner keeps
one window per page, keyed by the URL without its fragment: the owner's link
to the site carries a pass minted afresh on every visit, so two taps on
"Open the site" are two URLs for one window.

## Layout is the window's

Which panes this window shows is the window's own state: `sessionStorage`
per project (`lib/workbench/layout.ts` and `hooks/use-workbench-layout.ts`,
tested in `scripts/test/workbench-layout.ts`), kept across the window's
reloads and never shared — two full workbench windows of one project, one
per screen, each keep their own arrangement, which `localStorage` and its
cross-window `storage` event would have clobbered. Two columns need room: from `xl` the
open panes sit side by side; below it the window shows one at a time and
the strip's buttons choose which (`panesOnScreen`). Below `md` it is the
phone's rows.
A window arrangement is not a fact about the project. So there is no
column for it and no API — the project's STATE (threads, sessions, runs) is
shared through the server as everywhere, its windows are not.

The project's windows on one machine keep each other honest over a
`BroadcastChannel` per project (`lib/workbench/bus.ts`): a pane popped out
announces itself open (again when it returns from the back-forward cache),
and the window it left stops drawing it; on every way out — `pagehide`, or
a soft navigation away that unmounts the pane — it announces itself closed
and the pane comes back. A window ignores its own announcements.

## One pane, one window

`?pane=session` or `?pane=loki` makes the window that one pane: the sidebar,
top bar and bottom tabs are gone at every width (`body.fc-workbench-solo`,
`hooks/use-solo-window.ts`), and the pane's header offers Close, which
closes the window — or, where nobody's script opened it (a typed address)
and `window.close()` is a no-op, leads to the whole workbench.

## The phone

Below `md` the route is the same three things as rows — the site, Session,
Watch — each opening the phone's own shape of it. Two columns on a 390px
screen would be two unreadable strips, and no-screen mode and the
session's phone chrome exist for exactly that width.

## Full screen

The browser's own: `requestFullscreen` on the workbench root
(`hooks/use-fullscreen.ts`), Esc to leave. The desktop app's View → Toggle
Full Screen is the same thing one level up.
