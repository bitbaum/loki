# Workbench: one project on one screen

**Created:** 2026-10-30
**Last modified:** 2026-10-31 — the site is a picture of Loki's browser, the
robot has the one box, one line of state, one "⋯"; Loki's chat and the
Watch column are gone from the screen.

One project, read left to right like a sentence: **the site** as Loki's
browser sees it, then **the robot** at work with one line of state over it
and its ONE box under it. The real site is a window of its own, one tap
from the picture, beside this window or on the other screen. Route:
`/projects/[id]/workbench`; code: `src/components/workbench/`,
`src/lib/workbench/`, `src/config/workbench.ts` (the pane SSOT),
`desktop/src/main/workbench-windows.ts`.

## One thing to do, a few things to see

Options are what paralyse; views do not, as long as nobody has to choose
between them. The first cut of this screen showed about twenty controls at
once — the Sessions page's builder picker, tab strip, agent and view
switches, Loki's chat with a second box, Watch's card with its own
buttons, pane toggles, a window-placement menu — and the owner's verdict
was "tons of options … paralysis" (2026-10-31). So:

- **One box.** The session's own, which types into the live agent or
  starts one. It is the one thing the screen is for. Loki's chat is not
  here: beside the session's box it was a second place to type, and the
  session already offers Loki about itself ("What's going on?"). `/loki`
  stays its own page.
- **The robot.** `TerminalSurface` in its quiet shape (`quiet`): no
  builder picker (which builder runs a project is a stored decision,
  `lib/execution-access`), no tab strip of other projects, no shell rows.
  The view switch (chat | terminal) and the agent's name stay: they are
  how the robot is seen two ways, and the people who want the raw terminal
  are one tap from it.
- **One line of state** over the robot (`WorkbenchStateLine`): the
  sentence the Watch track already composes ("Pull request open",
  "Live on …", "Claude Code went quiet"), a dot for its tone, and "Watch
  it work" for the whole story. Watch's card said the same as a column of
  stages; on this screen that column was a second surface.
- **One "⋯"** for everything chosen rarely: the robot in its own window or
  on the other screen, the site on the other screen, full screen.

## The site is a picture of Loki's browser

Every fleet site answers with `frame-ancestors 'none'`, `X-Frame-Options:
DENY` and `Cross-Origin-Opener-Policy: same-origin`
(`scripts/site-template/lib/security.ts`, synced from bitbaum/fleet). The
first two mean a site cannot be an `<iframe>` in Loki; the third means a
site opened with `window.open` severs `window.opener`, so Loki cannot
reach it with `postMessage` either, and cannot even tell whether that
window is still open. Those headers are right for a public site, and they
are not Loki's to weaken from here.

What CAN be shown inside Loki is Loki's own browser. The review worker
(`scripts/inspection-worker.ts`, `lib/inspection`) runs a headless
Chromium on the box, walks the site, clicks, and keeps one frame per
action with the action named. `WorkbenchSiteView` shows that: while a
review walks, the robot using the site, frame by frame (the one thing no
window of yours can show, because it is not your browser); at rest, the
last look it took. A tap on the picture opens the real site in its own
window, where the person uses it and the widget does the watching —
pointing, a voice walk, "Fix it now" — exactly as it does today. The two
cases are different because the clicking hand is different, and each gets
the browser that is honest for it.

Everything flows through the server, which is the hub it already was: the
site's widget → server (notes, walks, "Fix it now" become runs), the
runner → server (the run, the track), the review worker → server
(frames), and the workbench reads all three. Nothing talks between
windows but the pane bus below.

## Windows and where they go

`lib/workbench/windows.ts` opens a window — the robot's pane, or the real
site — in the best way the platform offers, in this order:

1. **Fleet Runner.** The desktop app's main window sends every
   `window.open` to the default browser (`desktop/src/main/index.ts`, the
   window-open handler), so inside it the workbench asks through the
   bridge (`window.fleetRunner.openWorkbenchWindow`, v0.8.60+). The main
   process reads the real display list, puts the window on the other
   display or tiles this one (caller left, new window right; the shell
   keeps its 800px minimum and the new window takes the rest), and a
   window already open is restored, placed where the person now asks and
   brought forward instead of opened twice. One window per page, keyed by
   the URL without its fragment: the owner's link to the site carries a
   pass minted afresh on every visit.
2. **A browser with the Window Management API** (Chromium) names the
   other screen once the person allows it, and the popup is placed there.
   The permission prompt is raised when "on the other screen" is chosen,
   not on the open that follows: a click that waits for a prompt goes
   stale, and the browser then refuses the window as unasked-for.
3. **Any browser:** a popup sized to half this screen, left for the person
   to drag. A window this page already opened is brought forward, never
   navigated again (the site's address carries a fresh pass each visit,
   which a second navigation would leave unread in the address bar). A
   refused window is said on the page, not swallowed.

The placement arithmetic is one pure module both sides share,
`src/lib/workbench/placement.ts`, tested in
`scripts/test/workbench-placement.ts`. The "⋯" menu names the placement
per opening (`hooks/use-workbench-windows.ts`); the choice is remembered on
this device.

## Layout is the window's

Whether the robot is in this window or popped out is the window's own
state: `sessionStorage` per project (`lib/workbench/layout.ts`,
`hooks/use-workbench-layout.ts`, tested in
`scripts/test/workbench-layout.ts`), kept across the window's reloads and
never shared. A window arrangement is not a fact about the project, so
there is no column for it and no API.

The project's windows on one machine keep each other honest over a
`BroadcastChannel` per project (`lib/workbench/bus.ts`): the robot popped
out announces itself open (again when it returns from the back-forward
cache), and the window it left shows the site alone; on every way out —
`pagehide`, or a soft navigation away that unmounts the pane — it
announces itself closed and the robot comes back. A window ignores its own
announcements.

## One pane, one window

`?pane=session` makes the window the robot alone: the sidebar, top bar
and bottom tabs are gone at every width (`body.fc-workbench-solo`,
`hooks/use-solo-window.ts`), and the pane's header offers Close, which
closes the window — or, where nobody's script opened it (a typed address)
and `window.close()` is a no-op, leads to the whole workbench.

## Widths

From `xl` the site and the robot are side by side. Below it the window
shows the robot alone — the site is in its own window anyway, and a window
tiled beside it on a laptop is 720px. Below `md` the route is the same
things as rows — the site, the robot, Watch it work — each opening the
phone's own shape of it.

## Full screen

The browser's own: `requestFullscreen` on the workbench root
(`hooks/use-fullscreen.ts`), Esc to leave. The desktop app's View → Toggle
Full Screen is the same thing one level up.

## Next

A pointed-at element on the site landing in the robot's box, carried
through the server (the widget already talks to `/api/widget/*`; the app
already streams a project's events). A live stream of Loki's browser
rather than one frame per action, if watching the robot click turns out to
want it. Neither is built.
