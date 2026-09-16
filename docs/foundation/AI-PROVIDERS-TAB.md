# AI providers tab

## Goal
One screen so Cato (and every user) sees **what coding agents they have**, **logged in or not**, **tokens/quota when knowable**, **last interaction** — and can Login / Refresh / Set as default for Implement. Switching when one is empty must be **effortless**: auto-pick a live alternative when safe, or one clear ask (“which one?”) — never hunting Settings or only seeing Cursor/Grok.

## Rows (v1) — all coding agents we actually use
| Provider | Notes |
|----------|--------|
| Claude Code | “Cloud Code” in conversation = Claude Code CLI; show login + quota empty explicitly |
| Codex | show out-of-tokens / unavailable |
| Cursor | cursor-agent on cloud + this computer; login state |
| Grok | x.ai CLI |
| Antigravity (agy) | product name; orchestration id may stay `gemini` — one label in UI |
| ChatGPT / OpenAI | if wired as a builder |
| OpenRouter | API key + quota observation |
| OpenCode / OpenClaw | only if launchable; else hide |

Do not list Hermes in v1 default (optional later). Never ship a Needs-you chooser that omits Claude Code or Codex while they are in the agent registry.

## Columns
- Name + icon  
- Where: Cloud builder / This computer / API  
- Logged in: yes / no / unknown (never fake yes)  
- Tokens: remaining or “empty until {reset}” / unknown  
- Last interaction: relative time of last successful generate  
- Actions: Login, Refresh status, Use for Implement  

## Failover (P0 behavior, not only the tab)
When Implement / a run hits quota-dead or inject-no-generate for the current agent:
1. Prefer **auto-switch** to the next agent in `AGENT_FALLBACK_ORDER` that is installed, logged in, and not known-empty (same SSOT as this tab).
2. If several are viable and preference is unclear, **one ask**: “Claude is out of tokens — switch to Codex, Cursor, Grok, or Antigravity?”
3. One tap (or auto) sets project `agentPref` + Retry. Do not leave the operator on Retry against a dead provider.

Quota alternative chips and this tab share one list (see `src/config/quota-alternatives.ts` + agent registry).

## Data
- Reuse/extend `provider_quota` + CLI detect adapters (`src/lib/agents/*`).  
- Unknown is a first-class state (absent row ≠ full tank).  
- Login CTAs open the real CLI/device flow (hand box / Terminal), not a fake modal.

## Nav
Top-level **AI** beside Control / Feedback / Terminal (exact IA in CHROME-UX). Settings → AiQuotaSettings can deep-link here; this tab is the boss surface.

## Done when
Walk: open AI tab → see Claude Code / Codex / Cursor / Grok / Antigravity with honest login/token states; empty Claude → auto or one-ask switch to a live agent; Implement Needs you uses the same SSOT; no Cursor/Grok-only dead end.
