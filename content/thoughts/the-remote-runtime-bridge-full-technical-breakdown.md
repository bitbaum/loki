---
title: The Remote Runtime Bridge — Full Technical Breakdown
summary: A precise engineering account of how remote→local agent injection now works, what is still broken, and what the architecture needs next to become a genuinely useful mobile-first control plane.
excerpt: The daemon fix was twelve lines of bash. The gap it closed was a year of architecture work. Here is the complete technical picture — what works, what is silently broken, and what to build next.
publishedAt: 2026-05-16
supersededBy: /whitepaper
tags: architecture,daemon,zellij,runtime,mobile,engineering,deep-dive
featured: true
author: g
readingTimeMin: 20
---

## What We Actually Fixed

The remote injection pipeline has three distinct segments. Segment one — the user's phone to Vercel — was always working. Segment two — Vercel writing to the `pending_commands` table in Neon — was always working. Segment three — the local daemon reading that table and delivering the instruction to the right terminal process — was silently broken at the final step.

Here is the exact failure mode.

The daemon runs as a `systemd` user service:

```ini
[Service]
Type=simple
WorkingDirectory=/home/g/dev/cockpit
ExecStart=/bin/bash /home/g/dev/cockpit/scripts/cockpit-daemon.sh
Environment=COCKPIT_BASE_URL=https://loki.vercel.app
Environment=COCKPIT_DAEMON_TOKEN=<token>
```

Notice what is absent: `ZELLIJ_SESSION_NAME`. This variable is the key that tells `zellij action` subcommands which session to target. When you run `zellij action write-chars "hello"` from inside a Zellij pane, the variable is already set in your environment — Zellij injects it when it starts your shell. When you run the same command from a systemd service that was never launched from inside Zellij, the variable is not set.

Zellij's behavior when `ZELLIJ_SESSION_NAME` is absent and no `--session` flag is provided differs by subcommand. For `go-to-tab-name`, it emits the session list to stdout (because it does not know which session to switch in) and exits 0. For `write-chars`, it does the same thing. Nothing is written. The exit code is 0. The caller sees success.

The `inject_prompt` function in `agent-hook-lib.sh` had this shape before the fix:

```bash
inject_prompt() {
  local tab="$1" prompt="$2"
  [ -z "$tab" ] && return 1

  zellij action go-to-tab-name "$tab" 2>/dev/null         # 1. switch tab
  for i in $(seq 1 20); do
    active=$(zellij action dump-layout 2>/dev/null | ...)  # 2. confirm switch
    [ "$active" = "$tab" ] && break
    sleep 0.05
  done

  zellij action write-chars -- "$prompt" 2>/dev/null || true  # 3. type prompt
  sleep 0.2
  zellij action write 13 2>/dev/null || true                  # 4. press Enter
}
```

Steps 1–4 all silently no-op from a process with no session context. The `|| true` on steps 3 and 4 guarantees the function returns 0 regardless. The daemon logs `inject done ✓` and polls for the next command.

The journald logs from before the fix are diagnostic in retrospect. During every injection attempt, subprocesses appeared in the log with output like `marvellous-muskrat [Created 0s ago]` — the session list that Zellij was emitting to stdout instead of switching tabs. That output was the failure signature. It was readable all along.

## The Fix

The fix adds session discovery before any `zellij action` call:

```bash
_find_session_for_tab() {
  local tab="$1"
  zellij list-sessions -n 2>/dev/null | awk '{print $1}' | while read -r s; do
    if ZELLIJ_SESSION_NAME="$s" zellij action query-tab-names 2>/dev/null \
        | grep -qF "$tab"; then
      echo "$s"
      return 0
    fi
  done
}

inject_prompt() {
  local tab="$1" prompt="$2"
  [ -z "$tab" ] && return 1

  local zellij_session="${ZELLIJ_SESSION_NAME:-}"
  if [ -z "$zellij_session" ]; then
    zellij_session=$(_find_session_for_tab "$tab")
    [ -z "$zellij_session" ] && return 1
  fi

  ZELLIJ_SESSION_NAME="$zellij_session" zellij action go-to-tab-name "$tab" 2>/dev/null
  local i active
  for i in $(seq 1 20); do
    active=$(ZELLIJ_SESSION_NAME="$zellij_session" zellij action dump-layout 2>/dev/null \
      | grep 'focus=true' | grep 'tab name=' \
      | sed 's/.*tab name="\([^"]*\)".*/\1/' | head -1)
    [ "$active" = "$tab" ] && break
    sleep 0.05
  done

  ZELLIJ_SESSION_NAME="$zellij_session" zellij action write-chars -- "$prompt" 2>/dev/null || true
  sleep 0.2
  ZELLIJ_SESSION_NAME="$zellij_session" zellij action write 13 2>/dev/null || true
}
```

Key design decisions:

**Session detection only runs when needed.** If `ZELLIJ_SESSION_NAME` is already set (i.e., the caller is inside a Zellij pane — which is the local case), discovery is skipped entirely. The fix adds zero overhead to the local path.

**`query-tab-names` not `dump-layout` for detection.** `dump-layout` emits a full KDL layout tree which grows with pane complexity. `query-tab-names` emits one tab name per line. For a scan across multiple sessions, this is meaningfully faster and more stable to parse.

**`grep -qF` for exact match.** The `-F` flag disables regex interpretation. Tab names can contain characters that are regex metacharacters. This is defensive correctness that prevents false positives.

**The `ZELLIJ_SESSION_NAME=` prefix pattern, not `export`.** Using the env-var prefix on each command means the session name is scoped to that subcommand only. This is cleaner than `export`ing it into the function's environment where it could unexpectedly affect other Zellij commands called later in the session.

**Verified with `--session` flag alternative rejected.** The `zellij --session <name> action <subcommand>` syntax was tested and does not work for `action` subcommands in the current Zellij version. The `ZELLIJ_SESSION_NAME` env var is the correct mechanism. This was confirmed by testing both paths.

## What Is Still Broken

### 1. Voice Transcription on Remote

The microphone button in the project composer calls `POST /api/beacon/transcribe`. That route gate-checks `isRuntimeAvailable()` at line 26:

```typescript
if (!isRuntimeAvailable()) {
  return NextResponse.json(
    { error: "Transcription not available in cloud mode" },
    { status: 503 }
  );
}
```

`isRuntimeAvailable()` checks for filesystem access to local runtime paths — it is false on Vercel. The audio blob sent from a mobile browser reaches Vercel, receives a 503, and is discarded. No transcription happens. The microphone button on the live site shows a transcription error.

The local path is: `audio blob → ffmpeg (webm→wav) → python3 scripts/transcribe.py → local Whisper model → text`. All of this requires local runtime access, which Vercel does not have.

**Three paths to fix this:**

**Path A — Daemon audio relay.** The client sends the audio blob to Vercel. Vercel stores it (S3, Supabase Storage, or base64 in the `pending_commands` table). The local daemon polls, downloads the blob, runs local Whisper, POSTs the transcription back to a result endpoint. The client polls the result endpoint. Total latency: 8–15 seconds depending on audio length and Whisper model. Architecture cost: blob storage, result TTL, client-side polling for the transcription result separate from the command queue.

**Path B — Cloud transcription on Vercel.** When `isRuntimeAvailable()` is false, route the audio to OpenAI's Whisper API instead. Cost: ~$0.006 per minute of audio. Latency: 2–4 seconds. Implementation: 20 lines, one env var (`OPENAI_API_KEY`). No daemon changes. No client changes. The tradeoff is a cloud API dependency and a per-use cost.

**Path C — Browser SpeechRecognition API.** The `window.SpeechRecognition` API is available on Chrome for Android and iOS Safari. It runs on-device, zero latency, no server round-trip. Implementation: detect remote mode client-side and use `SpeechRecognition` instead of recording a blob. Quality is lower than Whisper and language support is browser-controlled. The upside is that it requires no backend changes at all.

Path B is the fastest implementation. Path A is the most architecturally consistent (everything stays local). Path C costs nothing but degrades quality.

### 2. Runtime State Not Visible on Remote

The Control Inventory panel on the live site shows:

```
Open tabs:  0
Running now: 0
Needs input: 0
```

These should show the actual Zellij state: which tabs are open, which agents are running, which sessions are waiting for input. They show 0 because the daemon's `push_runtime_state` function is either not pushing or the data is not being surfaced from the DB correctly.

The `push_runtime_state` function in `cockpit-daemon.sh` scans `/proc` for agent processes (`claude`, `codex`, `gemini`, `openclaw`) and reads sentinel files from `/tmp` to build a state payload. It POSTs this to `POST /api/control/runtime-state` every 2 seconds.

The state push is working (the daemon has been running since May 15). The data is in the DB. The issue is that `openTabCount` in the presenter is computed from `data.zellijTabs` — which is populated from the live runtime state — but only tabs where `agentRunning: true` are counted as "open". Since all agents are currently idle, `openTabCount` is 0.

This is a definition mismatch: "open tabs" should mean "Zellij tabs that exist for this project", not "Zellij tabs where an agent is actively running". The `agentRunning` flag comes from the `/proc` scan finding a `claude` process in the project directory. An idle Claude session (at the `$` prompt waiting for input) has no running process — Claude exited, Zsh is what is running. So the tab is open, the session is ready, but `agentRunning` is false.

**The fix**: populate `openTabCount` from the `activeAgents` array being non-empty OR from a separate `tabOpen` signal. The daemon could write a `/tmp/agent-tab-open-{tab}` sentinel when a session starts and remove it when the terminal closes. This would give a true "tab exists" signal independent of whether an agent process is actively running.

Alternatively, use the Zellij session layout itself: the daemon already has the tab list from its conf file, and it already knows the session via `zellij list-sessions`. It could include a `tabExists: boolean` field in the runtime state push that reflects whether Zellij actually has a tab by that name, regardless of what is running in it.

### 3. Tab Focus Side Effect

The current `inject_prompt` implementation calls `go-to-tab-name` before writing characters. This switches the visible tab in the Zellij session — if the user is actively looking at their terminal, the view jumps to the injected tab. This is almost always undesirable for remote injection: the user is not at their computer, so switching visible focus is unnecessary and mildly annoying if they return to find a different tab focused.

A cleaner implementation would write characters without switching focus. Zellij does not currently expose a way to write to an unfocused pane. This is a Zellij limitation, not a Loki limitation. The workaround would be to record which tab was focused before injection, inject, then restore focus — but this adds two more `zellij action` calls and a race condition window.

The pragmatic answer is to document this behavior and note that it is a Zellij API limitation.

## What This Architecture Now Makes Possible

With text injection working end-to-end, the remote control plane is real. Here is what that enables and what needs to change in the UI/UX to surface it correctly.

### Mobile-First Project Status

The current project cards in the remote Control view show: project name, status badge (idle/running), and a prompt input. This is adequate for a desktop user who checks in occasionally.

For a mobile user who may be the primary operator of the system, this is insufficient. A mobile user needs to answer three questions quickly: what happened while I was gone, what is the current state of each project, and what should I do next.

The answers to those questions are already in the system — the session handoff protocol captures exactly this — but they are not surfaced on the mobile view.

**What the mobile card should show:**

```
Revamp-Info                        [running 23m]
────────────────────────────────────────────────
done: Implemented fundraising form step 2 validation
next: Add server-side submission handler
tests: 12 pass
todos: 2
────────────────────────────────────────────────
[Continue →]  [Custom prompt]  [Stop]
```

This requires reading the `~/.claude/sessions/{tab}.md` handoff file and surfacing it in the runtime state push. The daemon already reads these files (the `_sentinel` function reads `/tmp` files; the same pattern applies to session files). Adding handoff content to the runtime state payload and surfacing it in the API response would give the mobile UI exactly what it needs.

### Temporal Summaries

The session handoff gives point-in-time state. What mobile users increasingly need is temporal context: what happened today, this week, this month.

The prompt history table (`prompt_history`) already captures every dispatch event with timestamps. The orchestration events table captures task starts, completions, and close requests. The git commit count per project is tracked. These are the raw materials for automated summaries.

A daily summary could be: for each project, count prompts dispatched, count commits pushed, read the last session handoff, and produce a two-sentence status. A weekly summary rolls these up and identifies which projects advanced and which stalled.

This is a natural job for an LLM endpoint — Groq at 2 seconds per call, as described in [Groq, Neon, and the Next Infrastructure Layer](/thoughts/groq-neon-and-the-next-infra-layer), could produce a daily digest for all active projects in under 30 seconds. The digest would be stored in the DB and surfaced as a dedicated "Fleet summary" view on mobile.

### Push Notifications

The daemon currently pushes state to the cloud every 2 seconds (the `_push_loop`). But it pushes regardless of whether anything changed. There is no event-driven notification path: if an agent finishes a long task at 2am and the user is asleep, there is no way for the system to send a push notification to their phone.

The infrastructure for this is closer than it looks. The daemon already POSTs to `/api/control/runtime-state`. The runtime state includes `closedAt` — a timestamp written when a session ends cleanly. A rule like "when `closedAt` transitions from null to a value, send a push notification" is implementable with Web Push (free) or a simple SMS service (Twilio).

The daemon does not need to change. A serverless function watching the `closedAt` field transitions would handle notification dispatch. The user's phone receives a notification: "Claude finished in Revamp-Info — 3 commits, tests passing. Ready for next step."

That notification is the phone buzz described in the Walk Test.

### Session Continuity on Mobile

The current UX on mobile requires the user to find the right project card, expand it, type a prompt, and send. For a power user managing ten active projects, this is manageable. For a user who checks in once a day and wants to continue each project that finished, it is too many steps.

A "Ready for input" queue — a dedicated mobile view listing every project where the agent has finished and is waiting — would reduce this to: open app, see list of waiting projects in priority order, tap each one, review handoff, tap Continue. Three taps per project instead of: scroll to find card, expand card, read nothing (because the handoff is not on the card), decide what to type, type it, send.

The data for priority ordering is already being generated: the attention score in `control-presenter.ts` ranks projects by urgency. The "waiting" filter is already computed. The gap is a dedicated mobile view that presents this queue without the full desktop layout.

## The Reliability Remaining Work

### Confirm-Write Gap

`zellij action write-chars` is fire-and-forget. It types characters and returns. There is no confirmation that the characters landed in the right pane or were received by the right process. If the tab switch from `go-to-tab-name` has not completed by the time `write-chars` fires — which can happen under load — the characters go to the previously focused pane.

The current polling loop (checking `dump-layout` for `focus=true`) mitigates this but does not eliminate it. The poll interval is 50ms and the loop runs at most 20 times (1 second total). Under normal conditions this is sufficient. Under terminal load or system resource pressure, it can fail silently.

A more robust approach: after `write-chars`, verify the text appeared by reading the pane's terminal output. Zellij does not expose a direct "read current pane buffer" API. The workaround is to write a sentinel (a unique string) before the actual prompt, then confirm the sentinel appeared in the pane output. This would require a separate mechanism to read terminal output — likely `tmux`-style piping or a PTY intercept — which is outside Zellij's current API surface.

For now, the existing poll is the best available option given Zellij's API.

### Multi-Session Edge Cases

`_find_session_for_tab` scans sessions in the order `zellij list-sessions -n` returns them. If two sessions have a tab with the same name (unlikely but possible), it returns the first match. If the correct session is the second, the injection silently fails again.

The right fix: also validate that the found session's tab's project directory matches the expected project directory. The daemon already has this information from the conf file. Adding a directory-match step to `_find_session_for_tab` would eliminate this ambiguity entirely.

### Daemon Restart Behavior

When `systemctl --user restart cockpit-daemon.service` is called, in-flight command claims are lost. The `pending_commands` table has a `claimed_at` field and a `status` field. Claims that are in-flight when the daemon restarts remain in `claiming` status indefinitely unless a timeout is implemented.

The fix: add a background job or a daemon startup routine that resets claims older than 60 seconds back to `pending`. This prevents commands from disappearing into a claiming limbo after a restart.

## The Architecture in Its Current State

```
Phone (browser)
  └─ POST /api/inject → Vercel
       └─ isRuntimeAvailable() = false
       └─ enqueueInjectCommand() → pending_commands (Neon)

Local daemon (systemd service, polling every 5s)
  └─ GET /api/control/commands → claim next pending_commands row
  └─ _find_session_for_tab(tab) → scan zellij sessions
  └─ inject_prompt(tab, prompt) → zellij action write-chars [FIXED]
  └─ PATCH /api/control/commands/:id {ok: true}

Daemon push loop (every 2s)
  └─ scan /proc for agent processes
  └─ read /tmp sentinel files
  └─ POST /api/control/runtime-state → runtime_states (Neon)

Vercel (SSE stream, 2s interval)
  └─ GET /api/control/stream → reads runtime_states
  └─ pushes project state to browser

Phone (browser, polling SSE)
  └─ receives project state updates
  └─ shows running/idle/ready status
```

What is missing from this picture to make it complete:

1. **Handoff content in runtime state push** (daemon reads session files → Vercel API → mobile card shows `done`/`next`)
2. **`tabExists` signal independent of `agentRunning`** (daemon writes sentinel when tab opens → correct `openTabCount`)
3. **Voice transcription on remote** (cloud Whisper API on Vercel, or daemon relay)
4. **Push notifications** (watch `closedAt` transitions → Web Push to mobile)
5. **Claim timeout recovery** (daemon startup cleans stale claims)
6. **Directory validation in session scan** (eliminate same-name-different-project edge case)

The command channel works. The state channel partially works. The notification channel is missing. The voice channel works only locally. That is the honest technical picture of where this stands.

## Why This Is the Right Architecture

It would be tempting, now that the text injection channel works, to ask: why not just run the agents in the cloud and remove the local daemon entirely?

The answer is cost, capability, and control.

A cloud runner capable of running Claude Code with filesystem access, Git, npm, and all the other tools that real development requires is either a full VM (expensive) or a heavily sandboxed container (limited). The local machine is already all of this, paid for, configured, trusted, connected to the user's actual repos, dotfiles, credentials, and environment. Replacing it would cost more and deliver less.

The daemon pattern — local capability, cloud coordination — is the right layering. The local machine is the runtime. The cloud is the control plane. The phone is the operator interface. This is exactly the architecture described in [From Localhost to a Portable Creation Loki](/thoughts/from-localhost-to-a-portable-creation-cockpit), and today's fix proved it is actually achievable without rethinking the foundation.

What needs to be built is not a different architecture. It is more complete instrumentation of the one that now demonstrably works.
