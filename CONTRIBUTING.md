# Contributing

Loki is optimized for clear ownership, tight feedback loops, and production
trust. Changes should be small enough to review and strong enough to ship.

## Before Editing

Read:

- `README.md`
- `AGENTS.md`
- `docs/architecture-first-principles.md`
- relevant domain files in `src/db/schema`, `src/db/queries`, and
  `src/components`

## Engineering Standards

These are non-negotiable and apply to every change. The authoritative, detailed
source is `AGENTS.md` (and the bitbaum/fleet `AGENTS.md` it points at), plus
`docs/architecture-first-principles.md` and the four-layer design system
documented in `AGENTS.md`. This list is the quick
checklist; read those for the "why". These are the bar — they should not need
restating per task.

- **First-principles, not analogy.** Derive each decision from the actual problem
  and constraints, not "other projects do X".
- **SSOT.** Every fact lives in exactly one place. Types derive from schemas;
  options/labels/constants/intents come from config, never re-listed (e.g. intent
  ids come from `ORCHESTRATION_TASK_INTENT_IDS`, never a local copy).
- **DRY.** Reuse existing primitives, hooks, API helpers, queries, and `ui-*`
  classes before writing new ones. Extract on the third repetition, not the first.
- **SoC.** `config/` = what exists; `lib/domain` = logic; `app/api` = thin HTTP;
  `components` = rendering; `hooks` = data/state. No business logic in components.
- **No god files.** Split anything that grows past ~300 lines or owns >1 concern.
- **No hardcoded values.** No magic strings/numbers/stats in code or JSX — source
  them from config or the database.
- **Design discipline (no stray design).** All visual decisions flow through the
  four layers (globals.css tokens → `@theme` → `ui-*` classes → JSX). Never put raw
  hex/rgb, palette colors, or arbitrary sizes in JSX or `tailwind.config`. Run the
  audit grep in `AGENTS.md` before committing UI.
- **Config-driven over code-driven** for anything that changes.
- **Validate inputs at the route boundary; preserve user/tenant scoping** in every query.
- **Modern stack, used correctly** (Next 16 App Router, TS strict, Drizzle, Tailwind 4).
- **Keep local-runtime behavior behind the daemon/bridge contracts.**

## Required Checks

Run the relevant subset while developing. Before pushing a broad change, run:

```bash
pnpm run verify   # the canonical gate — CI runs exactly this
pnpm run build
pnpm run smoke    # needs the dev server up
```

## Pull Requests

A good PR explains:

- what changed
- why the change matters
- how it was verified
- any production or migration steps
- remaining risks or follow-up work

Do not hide known risk in a summary. Put it directly in the PR.
