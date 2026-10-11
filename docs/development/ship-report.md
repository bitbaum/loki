# Ship report — done means seen

**created_date:** 2026-10-11
**last_modified_date:** 2026-10-11
**last_modified_summary:** First version: the shape of a finished message, the command that produces its proof, the usage record that lets Loki judge a shipped surface, and the message this replaces.

## The message this replaces

On 2026-10-11, "Build next" (#1141) was reported to the operator like this:

> CI passed and loki#1141 merged into main at 21:14 UTC. It should go live on
> its own once Loki's deploy picks it up a few minutes after the merge. I
> haven't confirmed that, or tried the screen in a browser myself.
> To see it, open /loki in Loki: the new "Build next" row sits under "What
> are we working on?". Tap a chip, or ask Loki "what should I build?". I've
> stopped watching the PR and removed the backup check.

Read on a phone at 23:27. Every sentence is true and the whole is useless:

- It reports a **merge, not a result.** `CLAUDE.md` already says "confirm the
  commit is LIVE, not just merged", and the fleet brief every dispatched agent
  reads says "done means merged, deployed and checked live". Both were skipped
  and the skipping was announced.
- **No proof anything exists.** No picture of the row, at any width. The reader
  cannot tell whether it rendered, overflowed, or loaded at all.
- **No link.** `/loki` is a path. On a phone the only thing that works is one
  tap to the live page.
- It **describes a UI instead of showing it**, which hands the reader the
  verification the writer skipped.
- It **walks away before the thing is live**, so a failed deploy would have
  been noticed by nobody.

This is the "no dead ends" rule applied to the agent's own report: a message
that says done with no way to look at it, walk into it and react is a dead end.

## The shape of a finished message

In this order, nothing before it:

1. **The live URL**, first line, tappable.
2. **Screenshots of the real deployed page**, phone width first, with one line
   each saying what changed. The section you built, cropped, when there is one.
3. **What was verified and what was not**, as two short lists. "Verified" with
   no list is the claim this contract exists to replace.
4. **What happens next**: the agent stays subscribed until the page is live,
   and Loki keeps the usage record (below) so the surface can be judged after
   it ships, not only before.

A merge notice, a CI link, or "it should go live on its own" is not a finished
message. If the deploy has not landed, say so and keep waiting — `--wait` below
does exactly that.

## The command

```bash
pnpm run ship:report -- /loki --title "Build next" --focus '[aria-label="Build next"]'
pnpm run ship:report -- /loki --commit <sha> --wait 900     # wait up to 15 min for the deploy
SHIP_BASE=http://localhost:3000 pnpm run ship:report -- /loki --no-live
```

`scripts/ship-report.mjs` answers three questions and writes
`.tmp/ship-report/<route>/REPORT.md` next to the screenshots:

| Question | How it is answered |
|---|---|
| Is it live? | `/api/health` reports the commit the box runs (`scripts/record-build-ref.sh` stamps it). Compared with `--commit`, else `origin/main`. `live` / `behind` / `unknown` / `down`, never inferred from a clock. |
| What does it look like? | The deployed page at 390px and 1440px, plus the `--focus` selector cropped. Console errors and 5xx responses during load are counted — a screenshot of a page whose data never arrived proves nothing. |
| What was checked? | Written into the report, with what was NOT checked beside it. |

It exits non-zero when the build is not live, the page did not render, or the
focused section is missing: a report that would have to say "not yet" is not a
finished ship. Paste the report, attach the PNGs, add what you tried by hand.

Auth is the responsive audit's: `LOKI_SESSION_TOKEN`, or `AUDIT_DATABASE_URL`
+ `AUTH_SECRET` to mint one (`scripts/test/lib/session-cookie.mjs`, shared).
`CHROMIUM_PATH` points it at a preinstalled browser in a sandbox.

## After it ships: the usage record

A surface is not finished when it is live; it is finished when it is used, or
changed because it was not. `operator_usage_events` records what the operator
does with each surface Loki built — shown, tapped, rotated — and Loki reads
the tally back as facts ("how am I using Build next?", and alongside every
"what should I build?"), so it can say which kinds of suggestion get taken,
which are offered for nothing, and propose the one change to the surface.

- Surfaces and the actions each allows: `src/config/usage-surfaces.ts` (SSOT;
  `/api/usage` refuses anything else).
- Recording from a component: `trackUsage({ surface, action, target })` from
  `src/lib/usage/track.ts` — fire-and-forget, never throws.
- Summary: `src/lib/usage/summarize.ts` (pure, tested in
  `scripts/test/usage-summary.ts`); Loki's adapter `src/lib/agent/sources-usage.ts`.
- `target` is an id or kind, never prose; visitors on customer sites are not
  operators and are not recorded here (that is `site_feedback`).

Adding a surface is one registry entry and three `trackUsage` calls. Loki
reads it without further change.
