# One-Click Development — implementation plan (2026-06-12)

North star (user's words): sign in, press one button that looks like **play**, and all
projects get built without supervision. Same button pauses. Per-project play/pause too.
Project profiles must hold the full static context (what the project should become) —
filled by AI from free-form text/voice, never by forms. Dynamic context (what happened,
what's next) must be one coherent story, not five overlapping surfaces.

> Status 2026-06-29: Phases 1, 2 and 4a DONE. **Phase 1 shipped:** `ui-control-hero`
> fleet autopilot card with Start building / Pause fleet, per-project Building/Paused
> toggles + rail override chips, pulsing dot when fleet is building.
> **Phase 1b (2026-06-29):** Start building calls `POST /api/control/fleet-kick` —
> kicks up to `MAX_CONCURRENT_BUILDING` (3) idle projects with `next_best`; Loki
> phrase "develop all my projects". **nudge-idle cron fixed** (`!= off`, was dead; retired 2026-10-10 for the autopilot night).
> **Phase 2a (2026-06-29):** Control rail **Build selected** / **Pause selected**;
> Loki multi-select command fan-out; screenshot → dispatch when project scoped.
> 2d re-run via
> `scripts/enrich-prod-profiles.ts --apply` — **18/18** prod projects now have full
> build-contract attrs (architecture/conventions/definition_of_done); last gap
> `reparaturbonus-zh` backfilled 2026-06-28.
> **Project retirement (2026-06-28):** `scripts/db/retire-stale-projects.ts --apply`
> merged Cockpit→loki, empty dupes (AOZ, SYL, Ivy, revamp-it, truthseeker-tmp),
> **swiss-longevity-hub→surf-your-life** (SLH renamed), and deleted infra/stub rows
> (dotfiles, kivitendo-erp, Catomean, FitFoot, Hirnli, Warbuffet, OpenClaw).
> Prod inventory: **18** project entities (was 32). `Bitbaum` runtime dir linked via
> `scripts/db/link-prod-runtime.ts`.
> **Phase 3 (2026-06-28):** prompt vocabulary SSOT in `config/control-labels.ts`
> — Saved prompts / Up next / Recent dispatches / Paste from history.
> consolidated /history + /digests; remaining overlap is naming, not
> architecture. BLOCKER discovered during deploy (2026-06-12): the Vercel team
> `orangecat` was blocked for fair-use overage — the then-current
> `loki.vercel.app` / `revampit.vercel.app` and orangecat.ch all served
> 402 DEPLOYMENT_DISABLED, and new deploys were rejected.
> RESOLVED: this triggered the full exit off Vercel — Loki and OrangeCat
> are now self-hosted on the Hetzner `bitbaum` box (Caddy + systemd), serving
> at loki.orangecat.ch / orangecat.ch. Deploys go via
> `scripts/deploy-hetzner.sh`.

## Phase 1 — Play/Pause UX (the wow)
State already exists: `beacon_settings.auto_inject_mode` (on|off) + `entities.auto_inject_mode_override`.

- [x] 1a. Global play/pause button in the /control hero (big, ▶/⏸, shows "Fleet autopilot:
      building / paused"). PATCH /api/beacon-settings. SSE already refetches on change.
- [x] 1b. Per-project play/pause button on ProjectCard replacing the ProjectAutopilotToggle
      dropdown. Click toggles effective state via override; small "auto" affordance to
      clear override back to inherit. PATCH /api/projects/{id} (existing contract).
- [x] 1c. Clear "building is happening" feedback already exists (SSE status, current prompt,
      sent prompts) — make sure the play state visually connects to it (pulsing dot when on).

## Phase 2 — AI-powered project context (no forms)
- [ ] 2a. New route POST /api/projects/[id]/brief: free-form text → Groq (callGroqText) →
      structured patch {description, mission, vision, customers, stack, status, next_step}
      → writes entities.description + attributes upserts. Zod-validated, length-clamped.
- [ ] 2b. UI: "Describe it" box in ProjectOverviewTab — paste/dictate anything, AI fills the
      profile, show what was set. No field-by-field form.
- [ ] 2c. Enrich-from-repo: POST /api/projects/[id]/enrich — fetch README (+ CLAUDE.md if
      present) from gitUrl via user's GitHub token, summarize via Groq, same structured
      patch path as 2a. Button on project profile: "Auto-fill from repo".
- [ ] 2d. Run enrichment for the real projects (Loki, OrangeCat, Revamp-it, Kivvi, …)
      against prod so profiles stop being empty.

## Phase 3 — Dynamic context cleanup (light touch)
/activity is already the consolidated surface; /history and /digests are redirects.
- [x] 3a. Naming pass only: "Sent prompts" vs "Your prompts" vs reuse autocomplete —
      make labels self-explanatory. No rewrites of working systems. SSOT: `config/control-labels.ts`.

## Phase 4 — Tell the story
- [ ] 4a. Thoughts post: one-click development / the play button as the product.
- [ ] 4b. Update session file + memory.

## Verification
- [ ] tsc + eslint (pre-commit), pnpm run smoke
- [ ] Browser-verify /control play/pause + describe-it flow (login with the test owner account)
- [ ] Push, deploy to the Hetzner box (`scripts/deploy-hetzner.sh`) and confirm the app restarts healthy.

Out of scope (explicitly): voice module unification across projects, OrangeCat financing
hooks, robot/physical-world orchestration — vision recorded in the Thoughts post instead.
