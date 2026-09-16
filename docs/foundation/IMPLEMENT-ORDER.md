# Implement order (loop works first)

Cato 2026-09-16 (locked): ship so **development through Loki works** before polish. Do not build AI/Robots/chrome until Feedback→Implement→visible work→PR is reliable. **Kitty / Zellij are optional overflow only** — not the development home. Ideal: develop everything inside Loki; Terminal aims at Zellij-class quality over time.

## Non-negotiable product loop

1. Client (or Cato) files feedback — already works.
2. Operator clicks **Implement**.
3. Immediately — not later, not by hunting Activity — Loki shows **where to watch**:
   - **Watch on this row** (auto-open), and
   - **Terminal** (Fleet Runner or cloud PTY — the session Loki owns), and/or
   - **Loki chat** (same project; commentary / inject),  
   agent- and model-agnostic. Best default may be both Watch + deep links; never status-only silence.
4. If the builder cannot run: **cause + exact next action** (Open Fleet Runner / Switch provider / Use cloud). Never bare Failed / Queued / Starting.
5. Keep trying and testing on production until this walk passes. Fail → diagnose → ship → retest. Do not abandon the loop for P1 polish.

## P0 — Loop works (blocking)

1. **Honest run states** (`HARNESS-SIMPLIFICATION.md`)  
   - This computer + runner offline → **Open Loki desktop / Fleet Runner** (or Switch to Cloud). Never silent Starting.  
   - Inject-no-generate → cause (quota / not logged in / no session) + one-tap Grok / Cursor / Antigravity.  
   - Never silent in-flight work — always phase + next action.  
   - Honor builder preference (Cursor / This computer / Cloud) — never silently fall back to Claude.

2. **Visible run chrome**  
   Implement/Retry auto-opens Watch with one-tap Terminal + Loki chat. Empty Terminal must say why (no Runner session ≠ Kitty pane) and what to open. Loki Terminal is Fleet Runner / cloud PTY — not a mirror of Kitty/Zellij.

3. **Working provider**  
   Prefer a provider with tokens (Cursor / Grok / …) on This computer (Runner online) or Cloud. Prove one Feedback → visible Watch/Terminal → PR walk on production **without opening Kitty**.

**Gate:** Until a live walk closes Implement→visible watch paths→useful agent work (or honest Needs you with a real CTA), do not start P1.

## P1 — After the loop works

4. **AI providers tab** (`AI-PROVIDERS-TAB.md`) — login/tokens/last used; feeds the P0 switcher.  
5. **Chrome UX** (`CHROME-UX.md`) — header account menu; fix minimized sidebar scroll.  
6. **Terminal quality** — raise Loki Terminal toward Zellij-class ease (scrollback, comfort, multi-session clarity) so Kitty stays closed by choice.

## P2 — Foundation expansion

7. **Robots tab** (`ROBOTS-TAB.md`) — two vacuums; humanoid-ready schema.  
8. Wire AI-tab SSOT into every Needs-you provider chooser.

Acceptance: each PR walked on loki.orangecat.ch; CI green; public name Cato only; docs in this folder stay current with the loop bar above.
