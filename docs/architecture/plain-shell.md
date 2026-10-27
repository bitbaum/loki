# The plain shell — a real command line on a builder, behind the PIN

**Status:** SHIPPED (this change). **Date:** 2026-10-27.
**Related:** `box-owned-pty-executor.md` (the runner this rides),
`private-builders.md` (why a tenant never gets one), `docs/development/cloud-local-workflows.md`.

## What it is

Tap **Sessions → Plain shell** and a bash login shell opens in a PTY the
builder owns: no project, no agent CLI, no inject wrapper. It is one more KIND
of session on the existing terminal, not a second terminal:

| Piece | Reuses |
|---|---|
| Open | the command queue: `open_shell` (`/api/shell/open` is the only producer) |
| Read | `peek-stream` → `peek_start` → the runner's PTY frames → the one xterm (`TerminalView`) |
| Type | the bridge's `rawkey` lane via `/api/control/tab-inject-raw` |
| Close | `close_tab`, through `/api/shell/close` |
| Survive a restart | `tab-memory` (`agent: "shell"` comes back as a fresh login shell) |
| Phone | the key deck (arrows, Esc, Tab, Ctrl), text size; **live keystrokes are always on** (a shell takes raw input; there is no agent box) |

Its tab is `loki-shell-<8 hex>`, minted by the server (`src/lib/shell-session.ts`).

### Why the cloud was excluded before, and what changed

`ShellWorkspace` (the old "Server shell" source) makes the **web app** spawn
PTYs. On the hosted control plane that is refused (`RUNTIME_AVAILABLE` unset):
a web deploy would kill every shell, and the PTY would inherit the web app's
environment (database URL, session secret). The new kind is spawned by the
**builder**, a separate process with its own lifecycle and a scrubbed
environment. `ShellWorkspace` is unchanged and still exists for local
development only (`RUNTIME_AVAILABLE=true`).

## Who may, and how it locks

Every request that opens, reads or types into a shell is checked on the
server (`src/lib/shell-access.ts`); hiding the button is a courtesy.

1. **A signed-in person.** A browser session only — never a `ck_` agent or
   runner bearer token, which the prompt-injectable agents on the box can hold.
2. **The operator's account** (`isFleetInfrastructureAllowed`, the `is_default`
   user). A builder seat, a client, a guest, a share link, the feedback widget:
   403 `not-operator`, and `/api/shell/status` tells them nothing.
3. **A PIN must be set, and entered recently.** No PIN configured = no shell
   (`pin-required`), not an open one. The PIN is the private-zone PIN; entering
   it sets a separate cookie (`loki-shell-unlock`, HMAC under `AUTH_SECRET`,
   `SameSite=Strict`). It lasts **10 minutes without typing** and **60 minutes
   at most**; typing slides it. An idle shell's output stream closes itself and
   the screen draws nothing of the session until the PIN is entered again (the
   shell keeps running).
4. **Rate limits:** 6 opens / 10 min, 5 PIN tries / min, keystroke posts capped
   far above typing speed; at most **3** shells per builder (server and runner).
5. **An explicit builder.** Keys must name `cloud` or `local`, so they cannot
   land on a second machine holding a tab of the same name.

Defence in depth against the real injection path (a sentence a stranger wrote
becoming a command): **no queued command except open / close / peek may name a
shell tab** — refused where every row is made (`enqueuePendingCommand`), again
in the runner's command validator, and again in `injectPty`. The shell's
screen is never sent to a model (no next-step suggestions, no Loki rail).

A tenant's runner (`loki-box-runner@.service`) carries `LOKI_SHELL=off`; any
runner with `LOKI_EXECUTOR=sandbox` offers none. `LOKI_SHELL=off` on any runner
is the kill switch (no shell can open; open ones are ended by closing them or
restarting the runner).

## The audit trail

`shell_audit_events` (migration `0129`): `unlock`, `unlock-failed`, `lock`,
`open`, `close`, `denied` (with a reason code), and the builder's own
`started` / `ended` (host, user, exit code). Each row has who, when, the
address it came from (Caddy's `X-Forwarded-For`) and the browser. **No command,
keystroke or output is ever captured.** Every row is also written to the app's
journal as `[shell-audit] {…}`. Append-only by use — `scripts/test/shell-routes.ts`
fails if any code updates or deletes a row — but the database does not forbid it
(a trigger would also block an account-deletion cascade).

## What it runs as — and what it can NOT do (read this)

On the cloud builder the shell runs inside the **box-runner's own sandbox**, as
the runner's user (`ubuntu`), and gets the same containment as every agent:

* `NoNewPrivileges=true` → **`sudo` does not work** (kernel-enforced).
* `InaccessiblePaths` hides `~/.ssh` and the other apps' directories
  (`/opt/orangecat`, `/opt/supabase`, `/opt/backups`, …).
* Its environment is a shell's (`PATH`, `HOME`, …) — **not** the unit's
  `DATABASE_URL`, GitHub token, or the engine keys agents get.

So it is a least-privilege operator shell: git, node, pnpm, curl, the repo
clones under `~/dev`, and the runner's own tree. It is **not** a root shell.

**What is left, and why it is not in this change:** operator jobs that need
root — installing systemd timers, `scripts/provision-service.py`, `psql` into
the Supabase container, anything under `/opt/*` — still need SSH
(`ssh root@167.233.22.31`) until a *privileged shell host* exists. That is a
second systemd unit without `NoNewPrivileges`/`InaccessiblePaths`, claiming
only `open_shell`, with its own presence so it does not fight the box-runner
over the heartbeat (runtime snapshots are keyed per account and channel). It
cannot be proven from CI, and a root-class unit that was never run on the real
box is the wrong thing to ship blind. Doing it is a deliberate step, taken on
the box, with this document's controls (operator, PIN, audit, kill switch)
already in front of it.

On **Your computer** the shell is a login shell of the user running Fleet
Runner, with that user's full environment (it is their own machine). It does not
come back after the app restarts (tab memory is the cloud builder's).

## What this does NOT protect against

* **A stolen session plus the PIN.** The PIN is four to twelve digits, tried
  five times a minute; a shoulder-surfed PIN and an unlocked phone is a shell.
* **A compromised web app or database.** Whoever controls the app can mint the
  unlock cookie (`AUTH_SECRET`) and queue `open_shell` rows; the audit trail
  lives in the same database.
* **Anything you type.** Nothing inspects or restricts commands; a shell can
  do what its user can. The sandbox above is the limit, not a filter.
* **Forged display.** A holder of a runner or agent bearer token can post
  frames to `/api/control/peek-frame` and make a shell's screen show text it
  never printed. It cannot type into it. Treat the screen as display, not proof.
* **The audit trail being edited by someone with database access.**
* **A builder running older code** simply never claims `open_shell`; the screen
  says the builder did not open a shell after 30 seconds.
