# Codebase Audit Report — Hardcoded Values, Magic Numbers, Secrets & SSOT

> **⚠ Snapshot from 2026-07-17 — re-checked 2026-09-02, and it has drifted BOTH ways.**
> Verify any line here against the code before acting on it.
>
> - **Item 3 (bare box IPs) is largely CLOSED**: `scripts/hetzner/_box-env.sh` exists
>   and is sourced across the hetzner scripts. Roughly 7 bare IPs remain.
> - **Item 8 (god files) got WORSE, not better**: `desktop/src/main/index.ts`
>   1254 → 1297, `poller.ts` 963 → 1044, `control-presenter.ts` 789 → 948 (and it
>   moved to `src/components/control/`). An unticked "LOW" item is not a stable one.
> - **Item 1 (rotate the PIN) is still open**, and this file was itself the last
>   place in HEAD printing the value — now redacted. See the item for detail.
>
> This is the failure mode of an undated point-in-time report: it keeps being read
> as current. If you update it, update this banner too, or retire the file.

**Date**: 2026-07-17
**Auditor**: Claude Code (Fable 5 — 6 parallel audit agents + 6 fix agents in 3 waves)
**Branch**: `main`
**Focus**: magic numbers, hardcoded values, secrets/identity leaks, SSOT violations
**Previous audit**: [2026-07-13 coherence/security audit](./AUDIT_REPORT_2026-07-13.md)

## Executive Summary

Six parallel auditors swept `src/`, `home/`, `desktop/src/`, `scripts/`, `docs/`, and
`content/` across six dimensions: design tokens, magic numbers, hardcoded
hosts/paths, secrets/identity, magic strings/SSOT drift, and fake data/rot. The
codebase confirmed the 2026-07-13 verdict where it matters most to users —
**zero fake metrics, zero dead-end links, zero `as any`/`@ts-ignore`, exactly one
TODO comment (properly annotated)** — but the sweep surfaced a real debt layer
underneath: a committed production PIN, identity leaks breaking the pseudonym,
no time primitives (one day spelled two ways across ~19 files), the run-outcome
union defined three times, and ~15 files bypassing SSOTs that already existed.

**Most findings were fixed in this session** across three commit waves (identity
scrub + URL/design SSOT + dead code; time primitives; string families). What
remains is listed under Open Items with severity — the single action only the
operator can take is **rotating the private-zone PIN**, since the old value
lives in git history.

## Health Score (audit-focus dimensions)

| Area | Before | After | Notes |
|------|--------|-------|-------|
| Fake data / dead ends | 10/10 | 10/10 | Clean both audits; marketing layer documents its live-data guarantees in code |
| Secrets & identity | 4/10 | 8/10 | PIN + email + real name scrubbed from HEAD; **history still holds them → rotate PIN** |
| Design tokens | 8/10 | 9/10 | 11 JSX violations fixed; framework-forced palettes (OG/email/xterm) still re-declare colors |
| Magic numbers | 5/10 | 8/10 | time.ts primitives now underpin ~47 files; HTTP-timeout tiers + widget cadences remain |
| Hardcoded hosts/paths | 6/10 | 9/10 | Product code fully on APP_URL/GITHUB_API_BASE; scripts/ IP spread remains |
| Magic strings / SSOT | 5/10 | 8/10 | Outcomes/attrs/kinds/channels/events consolidated; ORCHESTRATION_STATES adoption remains |

## What was found and fixed (by wave)

### Wave 1 — identity, secrets, URLs, design, dead code
- **Private-zone PIN** removed from 3 tracked scripts (usage examples now `<pin>`).
- **Identity scrub**: seed email now `SEED_OWNER_EMAIL` env (fallback
  `cato@orangecat.ch`); `GEORGE_USER_ID` → `OWNER_USER_ID`; "George" comments →
  "the operator" in code + docs + a published Thoughts essay; CODEOWNERS
  `@g-but` → `@catomean`;
  real phone + author paths anonymized; `/home/g` runtime fallback → `os.homedir()`.
- **`DEFAULT_USER_EXTERNAL_ID`** default `"george"` → `"self"`, with the entity row
  migrated in BOTH local and box DBs (`UPDATE entities SET external_id='self'`).
- **URL SSOT**: every product-code literal of the app's own domain now flows through
  `APP_URL` (desktop menus ×8, runner install banner, project-template READMEs ×4,
  frontier User-Agent, doctor route, `LOKI_PUBLIC_ORIGIN`); new
  `GITHUB_API_BASE` shared by 7 files; `ORANGECAT_BASE_FALLBACK` (was 4 copies);
  `LOCAL_DEV_URL` (was 3 copies); openclaw gateway fallback imports its constant
  (was silently re-hardcoded).
- **Design tokens**: `--scrim` + `ui-backdrop(-strong)` replace 4 raw `bg-black/NN`
  backdrops; `--toggle-knob`, `--surface-terminal` (cross-linked with
  terminal-theme.ts), `--text-compact`, `ui-pin-input`; `PIN_MAX_DIGITS=12` shared
  client/server — fixed a real 20-vs-12 `maxLength` drift on the PIN gate.
- **Dead code**: `HistoryFeed.tsx` and `loki-prompts.ts` deleted whole; 13 more dead
  exports removed; 3 candidates kept (used by scripts/tests). All 22 `console.log`
  verified intentional operational logging and kept.

### Wave 2 — time primitives (47 files)
- New `src/lib/constants/time.ts`: `SECOND/MINUTE/HOUR/DAY/WEEK_MS`.
  "One day" was `86_400_000` in 6 files and `24 * 60 * 60 * 1000` in 13 others.
- `SSE_KEEPALIVE_MS` (was 3 identical copies in stream routes),
  `RATE_LIMIT_WINDOW_SHORT/LONG_MS` (was 2+2 copies in auth routes),
  `LONG_TEXT_MAX=8000` (UI `maxLength` + API zod `.max` in 6 files can no longer drift),
  `MAX_BUFFERED_EVENTS` single-sourced, `control-presenter` in-file dup fixed.

### Wave 3 — string families (26 files)
- **`FAILING_OUTCOMES` / `isFailingOutcome()`** in `lib/events.ts` with a compile-time
  drift guard against the DB schema union (type-only import keeps `home/` free of
  drizzle). Replaced 5 hand-rolled `error|hang|timeout` checks — the dispatch brake,
  run-close, hero stall signal, and brain breadcrumb now share one definition.
- **`PROJECT_ATTR`** (`src/config/project-attrs.ts`): canonical attr-key SSOT; the four
  previously hand-synced lists (ContextEditor, project-brief, project-context,
  page-stats) now derive from it.
- **`PROJECT_DISPATCH_KINDS`** single-sourced (was declared 3×).
- Channel param validators → `z.enum(BUILDER_CHANNELS)` (3 routes).
- The one `{ success: true, data }` envelope (project-states PATCH) → `jsonOk`;
  verified zero readers of the old shape.
- `LOKI_OPEN_EVENT`/`LOKI_PREFILL_EVENT` centralized in `client-events.ts`.
- `SESSION_STATUS` imported at 3 raw comparison sites (2 lookalike sites correctly
  skipped — different vocabularies: push-notification kinds, fleet-kick skip reasons).

## Open Items (not fixed — prioritized)

1. **ROTATE THE PRIVATE-ZONE PIN** *(operator action, HIGH, STILL OPEN)* — the old
   PIN is in git history. Removing it from HEAD does not un-leak it, so rotation
   is the only real fix and only an operator can do it. Same caveat applies to the
   scrubbed email/name: history rewrite or acceptance is a deliberate decision.

   Note (2026-09-02): this report scrubbed the PIN from three scripts and then
   printed it twice in its own text, which left it as the ONLY file in HEAD still
   carrying the value it tells you to rotate. Both occurrences are now redacted.
   That does not close the item — the history leak is unchanged and rotation is
   still owed.
2. **Box workspace remotes embed the GitHub OAuth token** *(HIGH, infra)* — every
   `/home/ubuntu/dev/*` remote URL is `https://x-access-token:gho_…@github.com/…`.
   Works, but leaks into logs/ps. Move to a git credential helper on the box.
3. **`scripts/` Hetzner IP spread** *(MEDIUM)* — `167.233.22.31` in ~15 scripts with
   two conventions (env-fallback vs bare). Centralize into one sourced `_box.sh`.
4. **`ORCHESTRATION_STATES` adoption** *(MEDIUM)* — ~10 files still compare
   `run.state === "waiting"`-style raw strings; the SSOT tuple exists but is
   near-unused. Deliberately out of scope for wave 3 (broad blast radius).
5. **Framework-forced palette re-declarations** *(MEDIUM)* — OG images (satori),
   `lib/email.ts` (email HTML), `layout.tsx` themeColor, `terminal-theme.ts` (xterm)
   legitimately need literal colors but re-declare the palette in ~6 places.
   Worth one `lib/palette.ts` of exported TS mirrors so they can't drift.
6. **HTTP/subprocess timeout tiers** *(LOW-MEDIUM)* — the `10/15/30/45s` ladder and
   `15s/30s/120s` exec timeouts across ~15 files have no named tiers.
7. **Widget poll cadences bypass `REFRESH_CADENCE`** *(LOW-MEDIUM)* — WeatherCard,
   CalendarCard, ProjectsCiPanel inline their own `intervalMs`.
8. **God files** *(LOW)* — `desktop/src/main/index.ts` (1254), `poller.ts` (963),
   `control-presenter.ts` (789) are the split candidates.
9. **`/investors` traction copy** *(LOW)* — "a live fleet of 19 projects" is
   narrative copy with a hardcoded count that will rot; derive or soften.
10. **`desktop/src/main/index.ts:1157`** *(LOW)* — the repo's one TODO: boot-restore
    defaults hardcoded pending FleetLifecycleSettings; properly annotated.
11. **Bare `exhaustive-deps` disables** *(LOW)* — ~8 sites lack the one-line reason
    the other 18 have.

## Box workspace reconcile (same session)

All 16 `/home/ubuntu/dev/*` workspaces reconciled: 7 fast-forwarded (orangecat
was 107 behind, kivvi 39), surf-your-life (3) + truthseeker (1) real commits
pushed to origin, 4 diverged/dirty repos preserved on pushed
`box-checkpoint-2026-07-17` branches then reset clean, 6 remotes canonicalized
`g-but` → `bitbaum`. **revampit**: 50 unpushed agent commits checkpointed
and pushed; its hard reset to origin/main is deferred until the currently
running security-fix agent finishes (checkpoint makes it safe whenever).

## Verification

Every wave gated on: `tsc --noEmit` clean, `eslint src/ home/` clean,
`npm run test:unit` (36/36 files, includes the new `project-health` suite),
`npm run test:home` (150/150), `npm run check:design` ok. Production build +
projects-tour + box deploy verification follow in the shipping commit.
