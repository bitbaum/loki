# AI providers tab

## Goal
One screen so Cato (and every user) sees **what AI they have**, **logged in or not**, **tokens/quota**, **last interaction** — and can Login / Refresh / Set as default for Implement.

## Rows (v1)
| Provider | Notes |
|----------|--------|
| Cursor | cursor-agent on cloud + this computer; login state |
| Claude Code | often logged in; show quota empty explicitly |
| Codex | show out-of-tokens |
| ChatGPT / OpenAI | if wired |
| Grok | x.ai CLI; tokens available as of 2026-09-16 note |
| Antigravity (agy) | formerly Gemini naming in places — one label |
| OpenRouter | API key + quota observation |
| OpenCode | if in fleet |
| OpenClaw | only if launchable; else hide |

Do not list Hermes in v1 default (Cato has no sub; optional later).

## Columns
- Name + icon  
- Where: Cloud builder / This computer / API  
- Logged in: yes / no / unknown (never fake yes)  
- Tokens: remaining or “empty until {reset}” / unknown  
- Last interaction: relative time of last successful generate  
- Actions: Login, Refresh status, Use for Implement  

## Data
- Reuse/extend `provider_quota` + CLI detect adapters (`src/lib/agents/*`).  
- Unknown is a first-class state (absent row ≠ full tank).  
- Login CTAs open the real CLI/device flow (hand box / Terminal), not a fake modal.

## Nav
Top-level **AI** beside Control / Feedback / Terminal (exact IA in CHROME-UX). Settings → AiQuotaSettings can deep-link here; this tab is the boss surface.

## Done when
Walk: open AI tab → see Cursor logged-out vs Claude logged-in-no-tokens vs Grok has tokens; one tap Use Grok updates project agentPref; Implement Needs you respects the same SSOT.
