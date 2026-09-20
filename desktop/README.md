# Fleet Runner Desktop (for Loki)

This is the native desktop application — the **local runtime** for Loki
on the user's own machine (the "local fleet runner"). It is optional: cloud is
the default builder, and a project runs here only when its stored routing
decision says so ("Runs on" in Control → project profile, or a laptop-only
checkout).

The shipped design is documented in `docs/architecture/box-owned-pty-executor.md`
and `docs/development/cloud-local-workflows.md`. `docs/desktop-app.md` and
`docs/fleet-runner-pty-ownership.md` are the historical decision records.

## Current status

- Packaged native app (AppImage + .deb produced via electron-builder;
  macOS/Windows builds via `.github/workflows/desktop-release.yml`).
- **Ships in web-shell mode**: the main window loads
  `https://loki.orangecat.ch` directly and the user gets the exact same
  React tree the browser serves, plus native bits (tray, OS notifications on
  agent idle, persistent NextAuth cookies). One UI, two surfaces.
- Native IPC remains available via the preload-injected `window.fleetRunner`
  bridge — the web app detects Fleet Runner via the `FleetRunner/<version>` UA
  suffix and calls into the local runtime where it makes sense.
- **Owns every agent PTY.** A dispatch claimed from `pending_commands` spawns
  the agent CLI in a node-pty PTY inside the runner's own process tree
  (`src/main/pty-runtime.ts`, the same core the headless box runner uses) and
  writes the prompt there. An inject for a project with no live owned PTY
  fails loudly ("no running agent for … — dispatch to start one") and the
  cloud enqueues a dispatch instead. There is no multiplexer: no zellij binary
  is bundled, no `LOKI_RUNNER_PTY` switch exists.
- **No tab focus, no restore.** `focus_tab` is retired (the runner rejects it;
  watch the agent in the web terminal). There is no cold-start restore on boot
  and no Settings "Restoration" section — an agent runs while its PTY runs.
- Agent installers ("Install X" on Control) run in an owned PTY watchable in
  the web terminal. Peek reads the owned PTY buffer; the "This computer"
  terminal streams it live and accepts keystrokes.
- Real `home/` integration in the main process: loads your projects config
  from agent-projects.conf, uses `decide()`, renders prompts via the
  orchestration layer (`renderTaskForAdapter`) on every dispatch.
- The embedded `home/watcher` reacts to `~/.loki/sessions/*.md` changes
  and fires a native OS notification on every `worker.idle` event —
  fire-and-walk-away UX.

### Overriding the shell URL

```bash
# Point the desktop at the hosted production app (default)
LOKI_WEB_URL=https://loki.orangecat.ch ./Fleet-Runner-*.AppImage

# Or against a local dev server
LOKI_WEB_URL=http://localhost:3000 ./Fleet-Runner-*.AppImage
```

## Get the runnable app

End users should grab a signed installer from the
[download page](https://loki.orangecat.ch/download). For a local build
from source:

```bash
git clone https://github.com/bitbaum/loki.git
cd loki/desktop
npm install
npm run dist:linux    # or dist:mac / dist:win on those platforms
```

Then run:

```bash
chmod +x dist/Fleet-Runner-*.AppImage
./dist/Fleet-Runner-*.AppImage
```

(Or install the .deb / .dmg / .exe.)

On launch, the app loads the Loki control plane directly. Sign in with
the same account you use on the web; native APIs are injected via
`window.fleetRunner`, and the embedded watcher fires native notifications when
local agents go idle.

## Dev (for contributors)

```bash
cd desktop
npm install
npm run dev
```

## Packaging

```bash
npm run dist          # current platform
npm run dist:linux    # AppImage + deb
# etc.
```

## Cutting a release

`.github/workflows/desktop-release.yml` builds Fleet Runner for macOS, Windows,
and Linux from one tag push and uploads the signed installers to a GitHub
Release. To cut a release:

```bash
cd desktop
npm version patch     # or minor/major — bumps package.json + creates a commit
git tag fleet-runner-v$(node -p "require('./package.json').version")
git push --follow-tags
```

The workflow takes ~10 minutes. Once it's green, the binaries are at:

- `https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-linux-x86_64.AppImage`
- `https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-linux-amd64.deb`
- `https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-mac-x64.dmg`
- `https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-mac-arm64.dmg`
- `https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-win-x64.exe`

To test the workflow without minting a real release, dispatch it manually from
the Actions tab with `dry_run: true` — it builds on all three runners but
skips the publish step.

## Relation to existing code

- Builds on the `home/` pure pieces (state, decide, render, watcher) and the
  shared executor in `src/lib/agent-execution/`.
- The headless box runner (`scripts/box-runner.ts`,
  `loki-box-runner.service` on Hetzner) reuses this runner core without
  Electron; it is the default builder.

See the root
`content/thoughts/the-local-fleet-runner-and-remote-control-plane-architecture.md`
for the strategic "why".
