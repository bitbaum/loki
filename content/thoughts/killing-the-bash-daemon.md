---
title: Killing the Bash Daemon — One Local Executor, By Deletion
summary: Loki runs two parallel local executors on every developer machine today — a legacy bash daemon and the Fleet Runner desktop product. The bash daemon must die. This is the plan, written before the cuts so the cuts can be argued with.
excerpt: The customer who downloads Fleet Runner v0.9.0 never runs the bash daemon. So why is it running on the founder's machine? The customer's experience IS the production target. We are not on it. This essay closes that gap.
publishedAt: 2026-06-10
tags: architecture,fleet-runner,deletion,first-principles,executors,migration
featured: true
author: Cato
readingTimeMin: 11
---

## The Two Processes That Should Not Both Exist

`ps auxf` on the founder's machine, today:

```
loki-daemon.service           bash, scripts/loki-daemon.sh
/opt/Fleet Runner/fleet-runner-bin  Electron, desktop/
```

Both poll `/api/control/commands`. Both inject prompts into Zellij. Both push runtime-state. Their command sets overlap heavily — `inject`, `focus_tab`, `auto_continue`, `launch_agent`, `switch_agent`. They do the same job. They are running at the same time. They race each other for the same pending-command rows. We shipped a crash-window sentinel earlier today (commit `83d07ef`) to prevent the double-typing that race produces.

The fix was real. The race shouldn't have existed. The bash daemon shouldn't exist.

The Fleet Runner desktop is what we ship to customers — v0.8.0, productized, auto-updating, with a tray icon and a native menu. The bash daemon was the founder's pre-product MVP. It has been "about to be retired" for months. In the meantime it accumulates state, gets crash-window guards bolted on, and drifts further from what customers experience.

This essay argues for a delete-first migration. Not a port. A delete.

## Make the Requirements Less Dumb

The first step of [Elon's engineering algorithm](https://www.youtube.com/watch?v=t705r8ICkRw) is the easiest to skip: question every requirement. Every requirement is dumb until proven otherwise. So before we decide what Fleet Runner has to absorb from the bash daemon, we have to ask which of the bash daemon's responsibilities were ever load-bearing.

**Autopilot watchdog.** Today the bash daemon's `_autopilot_watchdog` polls `/tmp/agent-ready-<tab>` sentinel files and fires dispatches when a tab transitions to ready without a hook callback. The watchdog exists because Codex, Cursor, and Gemini don't emit Stop hooks like Claude does. Question: do we need autopilot for those agents at all? Most builders run Claude. The minority who run Codex can fire manually. Probably yes-but-not-urgent.

**Stop hook plumbing.** `scripts/agent-hook-bridge.sh` registers with Claude Code's hook system, watches for `Stop` events, parses the session file, POSTs to `/api/orchestration/runs/<id>/finish`, and triggers dispatch. This is OS-level coupling. It's fragile. It only works for Claude. Question: is there a simpler signal? Yes: Fleet Runner can watch `~/.claude/sessions/*.md` for mtime changes. When the file is rewritten with `status: ready`, that's the same lifecycle event the Stop hook fires on — without any hook integration at all. Filesystem watchers are universal; hook integration is per-agent.

**Prompt key resolution.** `_resolve_prompt` reads `~/.config/agent-prompts.json` and substitutes session-context placeholders. Question: does this need to live in bash? No — it's pure text manipulation. TypeScript does it better and the file is JSON.

**Transcription.** The daemon takes base64 audio, shells out to `ffmpeg`, then to `whisper`, returns text. Question: does this need to be in the executor at all? Electron has Web Audio APIs. Fleet Runner can record directly, send to Groq's Whisper endpoint, return text — no `ffmpeg`, no local binary, no daemon.

**Repair helper.** Emergency tool for recovering stuck states. Used roughly never. Question: do we need it? No. Delete.

After the questioning, the irreducible minimum Fleet Runner must absorb is:

- A filesystem watcher on `~/.claude/sessions/*.md`
- A function that reads `~/.config/agent-prompts.json` and resolves placeholders
- An autopilot trigger in TypeScript (probably 30 lines)

That's it. Everything else either already exists in Fleet Runner or shouldn't exist at all.

## Delete the Parts

The second step of the algorithm is the one most engineers refuse to do: actually delete. Not deprecate. Not migrate. Delete.

The targets:

```
scripts/loki-daemon.sh          ~1900 lines bash
scripts/agent-hook-bridge.sh          ~600 lines bash + hook config
scripts/agent-hook-lib.sh             ~400 lines bash
~/.config/systemd/user/
  loki-daemon.service
  loki-app.service               (the local prod build wrapper)
  loki-beacon-window.service     (pre-warmed Chromium — see below)
```

That is roughly **3,000 lines of bash plus three systemd units**. When deletion happens we keep `loki-app.service` because that's the dev/test local Next.js instance — not part of the executor surface.

We also delete from the codebase:

- `src/lib/orchestration/dispatch-gates.ts:evaluateDispatchGates`'s branches for `next_best`, `strategist` — see the consolidation below
- `src/app/api/control/dispatch/route.ts`'s entire Groq composition path (`callGroq`, `parseGroqResponse`, the prompt builder, the Evidence-for-pick guardrail I shipped earlier today in `73b8f0a`, the LOOP v2 wrapper in `680c7ed`)
- `src/lib/orchestration/wrap-loop-v2.ts` (created today, retired today — that's fine)
- The "beacon popup" window assets if we decide the popup itself isn't load-bearing

If reading this list makes you wince, good. The wince is the signal that you are deleting enough.

The corollary is Elon's other line: if you are not adding back at least 10% of what you delete, you didn't delete enough. After this list, we add back the filesystem watcher, the prompt resolver, and the autopilot trigger. Roughly 150 lines of TypeScript. That is about 5% of what we deleted. We may add another 5% as edge cases surface. We are well inside the rule.

## Cut Further: From Five Modes to Two

While we have the chainsaw out: the `auto_inject_mode` enum has five values today.

```
off | queue_only | beacon | next_best | strategist
```

Five is too many. The taxonomy was built when "strategist" was an aspirational future-default. It is now an opt-in path with low usage that two commits today (the Evidence-for-pick guardrail, the LOOP v2 wrapper) defended at the cost of architectural complexity. Both commits will be reverted as part of this work.

Cut to two:

```
on | off
```

`on` drains the user's queue and, when the queue is empty, fires the canned next-best template. The countdown popup becomes a toggle within `on` mode, not its own tier. `strategist` mode dies — clever, low-leverage, source of half the complexity in the dispatch route.

The schema migration is one ALTER TABLE — flip every `next_best` to `on`, drop `strategist`/`beacon` rows to whatever the user explicitly chose next (`off` if they wanted manual, `on` otherwise). Existing users either notice nothing or notice they have one fewer slider to think about.

## What "Ensure It Will Work" Actually Means

The user who asked for this migration asked for two things: follow the recommendation, and ensure it will work. The verification plan, in plain order:

**Pre-cut acceptance**:

1. Inventory every command type either executor handles. Confirm Fleet Runner handles each, or that the type is on the delete-or-skip list.
2. Walk the LOOP v2 fire path end-to-end on a test project with **only** Fleet Runner running. Bash daemon stopped via `systemctl --user stop loki-daemon`. Verify the filesystem-watcher → dispatch → inject chain works without the Stop hook.
3. Walk a manual queue-fire from `/control`. Verify the dispatch endpoint produces the same behavior with the simplified two-mode enum.
4. Walk a `peek_tab` from `/control` to confirm Fleet Runner's existing handler still works without the bash daemon.

**Post-cut acceptance**:

5. Disable and remove the bash daemon's systemd unit. Re-run the four scenarios above.
6. Build the new Fleet Runner with the absorbed pieces. Sign and install.
7. Use it for one week as the only local executor. Anything that breaks during that week either gets fixed in Fleet Runner or proves the feature wasn't needed.

**Acid test** (the only one that matters): a customer downloads `Fleet Runner v0.9.0` today and never runs the bash daemon. If their experience is whole, the founder's machine should be on the same experience. If their experience is missing something we use, we add it to Fleet Runner. If their experience is missing something we don't use, we leave it missing.

## Why Not Migrate

The alternative path — port the bash daemon's logic into Fleet Runner one feature at a time, keep both running until parity is reached, then flip — is what most engineering organizations would do. It is wrong here, for three reasons:

**It preserves all current complexity.** A migration that ports `_resolve_prompt` from bash to TypeScript will faithfully reproduce the placeholder substitution, the session-file fallback, the per-adapter session paths. Most of that complexity exists because the bash implementation was building toward something. Re-deriving from scratch lets us notice that placeholders only need to be substituted once at dispatch time, that the session-file fallback is now dead code, that per-adapter paths are an abstraction that never paid off.

**It takes longer.** A port-then-cutover plan is 3-4 sessions of careful translation. A delete-then-rebuild plan is one session of cuts and one session of minimum-viable absorption. The math is the same line count but the calendar is shorter and the result is smaller.

**Every day both executors run is a day the race condition exists.** We shipped a fix for that race today (`83d07ef`). The fix should not have been necessary. The race should not exist. The bash daemon should not exist.

## The Schema-Sync Gate Belongs in the Same Session

While we have permission to touch deploy and infrastructure: production was silently 2-7 days behind on schema this morning. Five additions had landed in local since 2026-06-08 — `users.fleet_settings`, `prompt_history.resolved_prompt`, `runtime_snapshots.panes`, two whole tables — none applied to Hetzner. Every code path that called `getDefaultUser()` was effectively broken on production for at least two days. Nobody noticed because the smoke suite only hits 44 routes that return 401 or 302 without ever exercising the queries that select all columns.

The Musk algorithm step on this is "automate" — and the right automation is a pre-deploy gate: a script that diffs `information_schema.columns` between local and Hetzner, refuses to ship if local declares anything Hetzner is missing, and prints the missing columns so the operator can review and apply manually. Two days of silent breakage cost more than the gate will ever cost to run.

This is not part of the bash-daemon migration but should ship in the same week. Both reduce the surface area where production can quietly diverge from what the founder sees on `localhost:3000`.

## What This Costs Us

We lose `transcribe` until Fleet Runner has it. The founder either records via the web app on the local Next.js instance or waits. Probably acceptable.

We lose `repair_helper`. Probably no one notices.

We lose `auto_continue` until the TS rewrite lands. The pause is minor — the feature can be reproduced in 30 lines of TypeScript when needed.

We lose `agent-prompts.json` resolution from the bash side, which means the daemon's three remaining customers (transcribe / repair / auto_continue) can't run during the gap. The gap is one session long if the cuts and the absorption happen on consecutive days.

We lose strategist mode entirely. Two commits from today (`73b8f0a`, `680c7ed`) are reverted. That is fine — they protected an opt-in path most users do not use, and the value-density per line of complexity was always low.

We lose three systemd unit files and the maintenance burden of keeping them aligned with the brand rename, the path drift, and the dual-source polling that built up over months.

What we gain is one executor. One implementation of the autopilot trigger. One place where prompt resolution happens. One language where the lifecycle of a dispatch is expressed end-to-end. One product that the founder runs and the customer also runs.

That is the real point. **The customer's experience is the production target.** When the founder runs a different stack than the customer downloads, every fix the founder ships is uncertain — does it work on the customer's stack too? Today the answer is "probably, we'll find out when they report it." After this work the answer is "yes, because that is the only stack."

## Plan

This essay is the plan. Three sessions, in order:

**Session A (cuts)**: stop and disable the systemd units. Remove the three bash scripts. Revert `73b8f0a` and `680c7ed`. Remove the Groq composition path from `dispatch/route.ts`. ALTER the `auto_inject_mode` enum to two values. Run the four pre-cut acceptance scenarios to document what breaks.

**Session B (absorption)**: build the filesystem watcher, the prompt resolver, the autopilot trigger inside Fleet Runner. Re-run the acceptance scenarios — five and six this time. Ship a new desktop release.

**Session C (schema-sync gate)**: write the diff-and-refuse script. Wire it into the Vercel `buildCommand` OR a GitHub Action that runs on push to main. Document the manual-apply flow. Promote to T0 in the roadmap.

If any session needs to split across multiple commits, the split happens at the obvious boundary — `git status` clean between commits, no commit captures more than one user-visible outcome.

The acid test runs at the end of session B. If Fleet Runner is the only local process and the founder's loop is whole, the migration worked. If not, we either patch Fleet Runner or accept the lost feature.

This is the bias toward deletion that long-running personal projects most often resist. We are resisting the resistance.
