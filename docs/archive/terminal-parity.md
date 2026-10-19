# Terminal parity & usability

**Status:** server terminal FIXED (deployed); machine-terminal interactive parity SHIPPED &
VERIFIED END-TO-END (2026-06-18) — bridge rawkey/resize fast lane + cloud endpoint + runner
0.8.9 + interactive TerminalView all live. The final literal keystroke-echo test is now done:
launched a throwaway Claude agent on `truthseeker` (the Fleet Runner spawned it in a fresh
owned PTY — confirmed `bash -lic … claude` as a direct child of the runner PID), opened "My machine" → that tab, typed `ECHOTEST42` in the browser xterm, and it
round-tripped the full chain (xterm onData → `POST /api/control/tab-inject-raw` → bridge
rawkey → runner `onRawKey` → `writeRawKey` → owned PTY → Claude TUI render → `pty.onData` →
peek-stream SSE → xterm) and echoed in the prompt box. Killing the test agent left the runner
green (0 restarts) — PTY isolation confirmed. **P4 (wrapper merge) DONE** — the two xterm
wrappers are now one transport-parameterized view (see Consolidation below).

Mao's complaint (2026-06-18): the in-app terminal is "abysmal — I cannot easily type
commands there, it's slow and awful, and there's no parity between the server and machine
terminals."

## What was actually wrong

### Server terminal ("This server") — FIXED
`src/components/control/WorkspaceTerminal.tsx` sent **every keystroke as its own concurrent
`fetch`** to `POST /api/workspaces/[id]` with no ordering. Under normal typing the POSTs
**raced**, so the PTY received bytes out of order — typing `echo parity-test` rendered as
scrambled garbage. Confirmed live in the browser.

**Fix (shipped):** buffer input and drain it through a single in-flight POST chain — order
preserved, bursts coalesced into fewer requests (also cuts echo latency). Benefits both the
Terminal page and the control-panel agent terminals (both render `WorkspaceTerminal`).

Remaining server-terminal polish (not yet done, low risk):
- Debounce the resize POST (only when cols/rows actually change).
- Verify the prod reverse proxy (Caddy) doesn't buffer SSE — `X-Accel-Buffering: no` is set
  in the stream route; confirm it survives the proxy. SSE flush is the biggest latency lever.
- (Bigger, later) move server PTY I/O to a WebSocket so keystrokes + output share one
  bidirectional, header-light channel instead of POST-per-key + SSE.

### Machine terminal — FIXED (2026-06-18; channel routing 2026-06-30)

Cloud and This computer terminals are **fully interactive** (`interactive={true}`):
keystrokes → `tab-inject-raw` → bridge `rawkey` → runner `writeRawKey`. Optional
`channel` (`cloud` | `local`) routes Cloud tab input to box-runner and This computer to desktop.

## Consolidation (organic-growth cruft — overlaps Thread B)

- **Two xterm wrappers** — DONE (P4). `WorkspaceTerminal` and the machine-side `TerminalView`
  both diverged only because one assumed read-only. They are now **one** component,
  `src/components/terminal/TerminalView.tsx`, parameterized by a `TerminalTransport`
  (`src/components/terminal/terminal-transport.ts`): `workspaceTransport(id)` drives a
  server-owned PTY (`/api/workspaces/[id]`), `runnerTransport(tab)` drives the Fleet Runner
  machine PTY (peek-stream + rawkey fast lane). The view owns xterm, the shared input-buffer
  (the server-terminal race fix, now in ONE place), fit/resize and chrome; the transport owns
  I/O. This is the "same xterm view, two substrates" the `TerminalSurface` doc-comment promised
  — now delivered. Adding a third substrate = a third factory, no view change.
- `PeekTabDrawer` now reads the owned PTY buffer (the zellij dump-screen snapshot it was
  built on is gone as of 0.8.19). It overlaps live PTY streaming — candidate for removal.
- `LiveTerminalPanel` / `LiveTerminalRows` on Control (renamed from `ZellijLivePanel` /
  `ZellijLiveRows` on 2026-09-11) render the runner's owned PTYs (`liveTabs` from
  `/api/control`); they overlap the "My machine" terminal — audit for retirement.

## Relationship to Loki

Interactive terminal parity serves **power users** who want raw shell control. For everyday
low-cognitive-load use, `docs/loki-command-surface.md` (the conversational composer) is the
higher-level answer. Both coexist; invest in terminal parity for the workbench, Loki for the
front door.
