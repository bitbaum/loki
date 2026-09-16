# Merge → live latency

**Rule (fleet):** one expensive Verify per change (on the PR). After a green squash merge to `main`, CI runs `pnpm run verify:main` (minutes), then Deploy (~3–6m). Do not re-run the full ~60m `pnpm run verify` on main for `(#N)` merges.

- PR / manual main push without `(#N)`: full `verify`
- Main squash/merge subject containing `(#123)`: `verify:main`
- Deploy still chains off green CI on main

If Deploy is **skipped**, the triggering CI was not success (often cancelled) — wait for tip CI green or `gh workflow run deploy.yml --ref main` after a green gate. Skipped ≠ Hetzner down.

See also the shared skill **Fast merge-to-live CI**.
