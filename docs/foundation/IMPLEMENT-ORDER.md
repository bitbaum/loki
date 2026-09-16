# Implement order (loop works first)

Cato 2026-09-16: ship so **development through FleetCrown/Loki works** before polish. Do not build AI/Robots/chrome until Feedback→Implement→visible work→PR is reliable on cloud.

## P0 — Loop works (blocking)

1. **Honest run states** (`HARNESS-SIMPLIFICATION.md`)  
   - This computer + runner offline → **Open Loki desktop / Fleet Runner** (or Switch to Cloud). Never silent Starting.  
   - Inject-no-generate → cause (quota / not logged in / no session) + one-tap Grok / Cursor / Antigravity.  
   - Never silent in-flight work — always phase + next action.

2. **Visible run chrome**  
   Implement/Retry auto-opens Watch or Terminal+Loki rail (same run id). Empty Terminal must say why and what to open.

3. **Working provider on Cloud**  
   Default builder Cloud for boss-mode. Prefer a provider with tokens (Grok) or complete Cursor/Grok CLI login on the box. Prove one Feedback → PR walk on production.

**Gate:** Until a live walk closes Implement→PR (or honest Needs you with a real CTA), do not start P1.

## P1 — After the loop works

4. **AI providers tab** (`AI-PROVIDERS-TAB.md`) — login/tokens/last used; feeds the P0 switcher.  
5. **Chrome UX** (`CHROME-UX.md`) — header account menu; fix minimized sidebar scroll.

## P2 — Foundation expansion

6. **Robots tab** (`ROBOTS-TAB.md`) — two vacuums; humanoid-ready schema.  
7. Wire AI-tab SSOT into every Needs-you provider chooser.

Acceptance: each PR walked on loki.orangecat.ch; CI green; public name Cato only.
