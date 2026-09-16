# Harness simplification

## Problem
Feedback → Implement leaves users guessing. Status badges (Queued / Starting / Working / Failed) appear without cause or remedy. Examples from 2026-09-16 walks:
- This computer + offline laptop runner → “Starting — waiting for first output” with no “Open Fleet Runner.”
- Claude/Grok: PTY launched + injected, agent not generating → Failed + Retry, not “quota empty” / “CLI not logged in on box.”
- Terminal: “No session named loki” while Feedback claims a run — stale session identity.
- Operators and assistants going quiet mid-task — same anxiety class as silent Queued.

## Principles
- One job → one path. Agnostic underneath; calm defaults on top.
- Verifier is evidence (heartbeat, PR URL, live stamp), not inject SUCCESS.
- Every blocking state has **cause + primary CTA**.
- Kill tab-name / mismatched session labels; run id owns the PTY.
- **Never silent in-flight work** — always show phase and what to do next (product + agent UX).

## Ship
1. **Builder offline / wrong place**  
   - This computer + no runner presence → Needs you: “Open Loki desktop (Fleet Runner) on this machine” + download/open link + secondary “Use cloud builder.”  
   - Cloud offline → “Cloud builder offline — reconnect box-runner” + Telegram path already exists.

2. **Provider dead**  
   - Detect: 429 / provider_quota remaining 0 / inject-no-generate within N seconds.  
   - UI: “Claude has no tokens until reset” (or “Grok CLI not logged in on cloud builder”) + buttons Cursor / Grok / Antigravity (hide known-dead). One tap sets agentPref + Retry. Hermes not in default chooser unless opted in.

3. **Terminal left + Loki right**  
   - ~60/40; mobile bottom sheet. Loki narrates phase/stalls/next from run_events (not log spam). Chat: Ask | Inject. Inject shows bytes in PTY. Implement auto-opens this view; Feedback Watch is a deep link.

4. **Delete/quarantine stale**  
   - No tab-name matching. Session attach by projectId/runId only. Audit Frankenstein Attention/Implement button clusters → one decision, one button.

## Done when
Walk: Implement on a Failed row → auto Terminal+Loki → if This computer offline, explicit Open runner; if Claude dry, explicit switch to Grok/Cursor; if healthy, streaming PTY + commentary. PR on bitbaum/loki.
