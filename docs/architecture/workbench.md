# Workbench: one project, side by side, on one screen or two

**Created:** 2026-10-30

A project's session and Loki as columns of one window, and the site in a
window of its own — beside it, or on the other screen. Route:
`/projects/[id]/workbench`; code: `src/components/workbench/`,
`src/lib/workbench/`, `src/config/workbench.ts` (the pane SSOT),
`desktop/src/main/workbench-windows.ts`.

## What it is for

Build something, use it, and say what to change without leaving the screen
it is on. The widget on the site already does the saying — pointing at an
element, a voice note while scrolling, "Fix it now" for the owner — and the
Sessions page already shows the build as it happens. The workbench is the
arrangement: those two beside Loki's chat, and the site where a second
screen or a second window puts it. Nothing in it is new UI. The columns are
`TerminalSurface` and `LokiWorkspace`, mounted as they are; the site is the
live page with the owner's pass in the fragment (`lib/feedback/owner-pass.ts`).

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
the Loki column's composer. The transport for that is the server (the widget
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
   tiles this one (caller left, new window right), and brings an open
   window forward instead of opening it twice. The placement arithmetic is
   pure (`desktop/src/main/workbench-placement.ts`,
   `scripts/test/workbench-placement.ts`).
2. **A browser with the Window Management API** (Chromium) names the other
   screen once the person allows it, and the popup is placed there.
3. **Any browser:** a popup sized to half this screen, left for the person
   to drag. A blocked popup is said on the page, not swallowed.

Where new windows go — beside, or the other screen — is one choice in the
strip, remembered on this device, and the same choice drives the site and
every popped-out pane.

## Layout is device-local

Which panes this window shows lives in `localStorage` per project
(`lib/workbench/layout.ts`, tested in `scripts/test/workbench-layout.ts`).
Two screens are one machine; a laptop and a phone want different
arrangements of the same project; and a window arrangement is not a fact
about the project. So there is no column for it and no API — the project's
STATE (threads, sessions, runs) is shared through the server as everywhere,
its windows are not.

The project's windows on one machine keep each other honest over a
`BroadcastChannel` per project (`lib/workbench/bus.ts`): a pane popped out
announces itself open, and the window it left stops drawing it; when that
window closes (`pagehide`), the pane comes back. A window ignores its own
announcements.

## One pane, one window

`?pane=session` or `?pane=loki` makes the window that one pane: the sidebar,
top bar and bottom tabs are gone at every width (`body.fc-workbench-solo`,
`hooks/use-solo-window.ts`), and the pane's header offers Close, which
closes the window. `LokiWorkspace` keeps its thread and project in the URL
so Back works; on the workbench it is told the host path (`basePath`) and
the project (`project`) instead of reading `/loki?project=`.

## The phone

Below `md` the route is the same three things as rows — the site, Sessions,
Loki — each opening the phone's own shape of it. Two columns on a 390px
screen would be two unreadable strips, and no-screen mode and the
session's phone chrome exist for exactly that width.

## Full screen

The browser's own: `requestFullscreen` on the workbench root
(`hooks/use-fullscreen.ts`), Esc to leave. The desktop app's View → Toggle
Full Screen is the same thing one level up.
