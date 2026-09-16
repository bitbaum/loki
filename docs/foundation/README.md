# Loki foundation — product redesign (Cato, 2026-09-16)

**Public name: Cato only.** Do not put legal names on GitHub, hire pages, or public UI.

Loki’s bar: **easiest place to build things** and **most powerful** — agent-agnostic, model-agnostic, flexible; pick the best providers. Failures always explain **cause + exact next action** (never bare Queued / Retry / Starting). Agents and Loki itself must never go silent while work is in flight — always show status and what happens next (same bar as human UX).

**Aspiration (locked):** develop everything inside Loki. No Kitty or Zellij required. Loki Terminal should reach Zellij-class quality over time; Kitty is optional overflow only. Client feedback → Implement → immediate Watch / Terminal / Loki chat paths is the core loop — keep docs, roadmap, and tests aligned with it until it works live, then keep it working.

This folder is the SSOT for a multi-PR program. Ship in the order in `IMPLEMENT-ORDER.md`. Each slice has its own brief; do not boil the ocean in one PR. When Cato restates the loop, update these docs in the same change set — do not let aspirations drift.

| Doc | What |
|-----|------|
| `HARNESS-SIMPLIFICATION.md` | Explicit failures, local-runner prompt, provider hot-swap, Terminal+Loki rail, kill stale identity |
| `AI-PROVIDERS-TAB.md` | AI tab: subscriptions, login, tokens, last interaction |
| `ROBOTS-TAB.md` | Robots tab foundation (2 vacuums now; humanoids later / optional split) |
| `CHROME-UX.md` | Header/footer/nav like OrangeCat quality; kill Frankenstein sidebar |
| `IMPLEMENT-ORDER.md` | PR sequence + acceptance walks + non-negotiable loop |
| `RUN-STATUS-SSOT.md` | Canonical Queued/Starting/Working/Needs you/Done/Failed for every surface |

**Related live pain (2026-09-16):** Implement → silent status / inject fail without watch chooser; Claude/Grok PTY inject without generate; “This computer” without “open Fleet Runner”; Loki Terminal empty while Kitty is busy (different session world); no account menu in header; minimized left rail horizontal scroll; operators left wondering if anything is happening.
