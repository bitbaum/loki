# Harness simplification

## Problem
Feedback → Implement leaves users guessing. Status badges (Queued / Starting / Working / Failed) appear without cause or remedy. Examples from 2026-09-16 walks:
- This computer + offline laptop runner → “Starting — waiting for first output” with no “Open Fleet Runner.”
- Claude/Grok: PTY launched + injected, agent not generating → Failed + Retry, not “quota empty” / “CLI not logged in on box.”
- Terminal: “No session named loki” / “nothing running on this computer” while a Kitty/Zellij pane is busy — **Loki Terminal only lists Fleet Runner / cloud PTYs**, not OS terminals. Kitty is not the development home.
- Implement succeeds (or fails) with only a badge — no auto Watch, no Terminal / Loki chat deep links.
- Operators and assistants going quiet mid-task — same anxiety class as silent Queued.

## Principles
- One job → one path. Agnostic underneath; calm defaults on top.
- Status vocabulary is **RUN-STATUS-SSOT.md**: Queued / Starting / Working / Needs you / Done / Failed. **Working** only with post-prompt generation evidence — one alive bit shared by Feedback and Terminal.
- Verifier is evidence (post-prompt PTY frames, PR URL, live stamp), not inject SUCCESS or a progress timer alone.
- Every blocking state has **cause + primary CTA**.
- Kill tab-name / mismatched session labels; run id owns the PTY.
- **Never silent in-flight work** — always show phase and what to do next (product + agent UX).
- **Loki-only development** — Implement opens Watch + Terminal + chat paths; operator should not need Kitty open.
- **Cloud-first default**: always-on box-runner is the home path; local Fleet Runner is for laptop-locked projects only. Do not expand dual-channel status language — channel is detail on Queued/Needs you, not a second vocabulary.

## Ship
1. **Builder offline / wrong place**  
   - This computer + no runner presence → Needs you: “Open Loki desktop (Fleet Runner) on this machine” + download/open link + secondary “Use cloud builder.”  
   - Cloud offline → “Cloud builder offline — reconnect box-runner” + Telegram path already exists.

2. **Provider dead**  
   - Detect: 429 / provider_quota remaining 0 / inject-no-generate within N seconds.  
   - UI: “Claude has no tokens until reset” (or “Grok CLI not logged in on cloud builder”) + buttons Cursor / Grok / Antigravity (hide known-dead). One tap sets agentPref + Retry. Hermes not in default chooser unless opted in.
   - Honor Cursor / builder preference — never silent Claude fallback.

3. **Watch / Terminal / Loki chat after Implement**  
   - Click Implement → auto-open Watch on the row with one-tap Terminal and Loki chat (project-scoped; honest stub if run-chat is not ready).  
   - Terminal chrome: PTY left + Loki commentary/inject rail right (~60/40; mobile bottom sheet). Rail is phase / stall / next action from `run_events`, not a log dump. Ask vs Inject share the session; after Inject the rail shows PTY bytes + ack. Quota death offers Grok / Cursor / Antigravity here.  
   - Feedback Watch deep-links the same run (`?run=`). Empty Terminal explains Runner vs Kitty and the next action.

4. **Delete/quarantine stale**  
   - No tab-name matching. Session attach by projectId/runId only. Audit Frankenstein Attention/Implement button clusters → one decision, one button.

## Done when
Walk **without opening Kitty**: Implement on a feedback row → auto Watch with Terminal + Chat links → healthy provider streams in Loki Terminal (or honest Needs you with Open Runner / switch provider). PR on bitbaum/loki; walked on production. If it fails, keep shipping and retesting until it passes.

## Run status SSOT

All surfaces use **one** status vocabulary: see `RUN-STATUS-SSOT.md`. Working means post-prompt generation evidence only — Feedback, Terminal, and Activity must not disagree.
