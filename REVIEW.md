# REVIEW.md — loki review bar

Judge the DIFF against these gates, in order. Flag correctness and requirement
gaps only — lint owns style. Global standards load via CLAUDE.md; this file is
ONLY loki's scars.

## Fatal invariants (one violation = block)

1. **API envelope is `{ok: true|false}`** — NOT the global `{success, data}`
   convention. This repo deliberately overrides it (see CLAUDE.md).
2. **Dispatch/orchestration state has ONE owner** — no new `/tmp` signal files,
   no new `claude-*` compat paths, no second writer to dispatch status. The
   split-authority loop is the repo's #1 historical bug source (13 of 15 recent
   commits were dispatch reliability fixes). Regression net: `scripts/test/`
   dispatch tests — extend, never bypass.
3. **Design system** — only `ui-*` component classes + tokens from globals.css;
   no arbitrary hex/radius/shadow. Check `check:design` passes.
4. **Runner protocol changes need a runner RELEASE** — publishing goes through
   the `loki-releases` feed (NOT `loki`); a protocol change without
   a release strands every installed runner.

## Repo gotchas that have bitten before

- Tailwind v4 silently drops an entire `@layer components` block if any rule
  uses a responsive variant inside `@apply` (e.g. `sm:p-6`) — no error. If
  component classes vanish, check this first.
- bashrc zellij auto-attach can hijack a runner-owned PTY — guard with
  `$BASH_EXECUTION_STRING` (already in dotfiles; don't regress it).

## Process gates

- `npm run test:unit` green (auto-discovers `scripts/test/*.ts`); CI green on PR.
- Diff updates CLAUDE.md/docs if it changes documented structure/behavior.
- Second fix of the same bug class ships the rule/test that ends the class.

## Definition of done for a page (a scar, 2026-09-28)

A PR that adds a link to a page is not done until the target page has been
RENDERED with what that link carries and LOOKED AT at 390px. Not the source
read, not the types checked: the pixels.

What happened: #959 sent an owner from My feedback to `/feedback?project=<id>`.
The inbox filtered by project NAME, so the page printed "Nothing waiting on
you for 5936f8fb-7239-…" at the person who had just pressed Implement — on a
page whose chips, stat cards and section heads were each drawn in a different
style. Every check was green. The owner found it on his phone.

Two rules, both mechanical:

1. **A link carries what the target reads.** Before wiring `href` to
   `?param=`, open the target and read how it consumes that param (name vs
   id, slug vs uuid). If the two disagree, the target resolves both, and the
   PR says so. Never trust that a page "takes a project".
2. **Render before claiming.** `node scripts/preview/build-feedback-preview.mjs`
   renders the real `/feedback` inbox with fixture rows at phone and desktop
   widths, in both themes, for every `?project=` shape, and fails on
   horizontal overflow or a console error. Run it and OPEN the PNGs in
   `.tmp/feedback-preview/` — the tool cannot see ugly, only broken. A new
   surface that has no harness gets one in the same PR (copy that script:
   esbuild + shims for `next/link` and `next/navigation`, `globals.css`
   through `@tailwindcss/postcss`, a mocked `fetch`); the harness does not need
   a database or a session, which is exactly why "I could not test it in the
   sandbox" is not a reason.

The same sentence, from the person who found it: "before you say that
something is done, why would you not go through it and test it?"
