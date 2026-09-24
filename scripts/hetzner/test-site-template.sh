#!/usr/bin/env bash
#
# The scaffold's CI floor must not drift.
#
# `scripts/site-template/.github/workflows/ci.yml` is the THIRD copy of the
# golden CI floor. The other two live in fleet/templates/ci/ (ci-npm.yml and
# ci-pnpm.yml). On 2026-09-07 a fleet sweep found 14 of 32 repos rebuilding Next
# from scratch on every CI run and fixed both fleet templates — and missed this
# one, which is the copy the scaffold actually uses. Every site created in
# between started cold by construction.
#
# fleet's cicd-hygiene-audit.sh ratchets the same property, but it scans repos
# that already EXIST. A template defect is upstream of that: it ships the flaw
# into each new repo, and the ratchet then reports it once per repo, forever.
# This test is the upstream half.
#
# It asserts PROPERTIES the floor requires, not the file's exact text, so
# ordinary edits stay free and only a missing floor element fails.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CI="$HERE/../site-template/.github/workflows/ci.yml"

pass=0
fail=0
ok()  { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  ✗ %s\n' "$1"; }

echo "site-template CI floor"

if [ ! -f "$CI" ]; then
  echo "  ✗ scaffold has no ci.yml at all — every new site would deploy unverified"
  exit 1
fi
ok "the scaffold ships a ci.yml"

# Every new site must merge its own green PRs, or an agent's fix waits for a
# human forever (the last manual click on the loop, 2026-09-11).
AM="$HERE/../site-template/.github/workflows/auto-merge.yml"
[ -f "$AM" ] || { echo "  ✗ scaffold has no auto-merge.yml — agent PRs would wait for a human"; exit 1; }
grep -q 'auto-merge-sweep.yml@main' "$AM" || { echo "  ✗ auto-merge.yml does not call the fleet sweep"; exit 1; }
grep -q 'ci_workflow: ci.yml' "$AM" && grep -q 'deploy_workflow: deploy.yml' "$AM" \
  || { echo "  ✗ auto-merge.yml must name ci.yml as CI and deploy.yml as the deploy"; exit 1; }
grep -q -- '--if-present lint' "$CI" || { echo "  ✗ ci.yml must tolerate a starter without a lint script"; exit 1; }
ok "the scaffold ships an auto-merge.yml that names its CI and Deploy"

# Without this the chain after an auto-merge is: token merge (no push event) →
# re-armed CI (no workflow_run) → nothing. The site then waits for the sweep's
# reconciler tick (kaffeeklappe-sep11 waited an hour, 2026-09-11).
grep -q "^  ship:" "$CI" || { echo "  ✗ ci.yml has no ship job — an auto-merged PR would wait for a sweep tick to deploy"; exit 1; }
grep -q "gh workflow run deploy.yml" "$CI" || { echo "  ✗ ci.yml ship job does not dispatch deploy.yml"; exit 1; }
grep -q "event_name == 'workflow_dispatch'" "$CI" || { echo "  ✗ ci.yml ship job must fire only for workflow_dispatch, or a push would ship twice"; exit 1; }
ok "ci.yml ships on green main without waiting for a sweep tick"

# Read once. Comments are NOT stripped: this file's comments deliberately name
# the very things it checks for, and a comment-blind scan would pass on a file
# whose only mention of `.next/cache` is prose explaining its absence. So each
# check below looks for the ACTIVE construct, not the bare word.
src="$(cat "$CI")"

# NO `printf ... | grep -q` ANYWHERE IN THIS FILE.
#
# Under `set -o pipefail` that construct is a race: grep -q exits at the first
# match and closes the pipe, printf takes SIGPIPE, and the pipeline reports
# FAILURE even though the match SUCCEEDED. It is NOT confined to payloads past
# the ~4KB pipe buffer, as this comment once said: measured 2026-09-24 at 1,158
# bytes, 2 false misses in 3,000 (scripts/test/no-grep-q-in-a-pipe.ts). That
# belief is why 82 other copies outlived the fix here. It presents as a gate
# that fails once and passes on retry — the worst shape a CI check can have.
# Use a here-string; it is not a pipeline.
want() { # want <description> <grep-E pattern>
  if grep -qE "$2"; then ok "$1"; else bad "$1"; fi <<< "$src"
}

want "restores .next/cache (a build job without it recompiles from scratch)" \
     '^[[:space:]]*path:[[:space:]]*\.next/cache'
want "uses actions/cache for that restore" \
     'uses:[[:space:]]*actions/cache@'
# The cache key must hash the lockfile the SCAFFOLD ACTUALLY EMITS.
#
# This check used to accept `hashFiles(.*lock` — any lockfile-shaped name. It
# passed while the key hashed `package-lock.json`, a file this scaffold never
# creates: hashFiles() on a missing path returns an empty string, so the key was
# constant and the cache never invalidated on a dependency change. A cache that
# is present, keyed, and permanently stale looks exactly like a working one.
want "keys the cache on pnpm-lock.yaml — the lockfile this scaffold emits" \
     "hashFiles\\('pnpm-lock\\.yaml'\\)"
# Comment-aware on purpose. ci.yml's own comment explains WHY it no longer uses
# npm — and naming `package-lock.json` in that explanation is not a reference to
# it. A raw grep failed on exactly that, which is the gate refusing to permit its
# own rule being written down. Strip `#` comments, then look at what runs.
if printf '%s\n' "$src" | sed 's/#.*//' | grep -q "package-lock.json"; then
  bad "ci.yml USES package-lock.json, which this scaffold never creates"
else
  ok "no live reference to a lockfile the scaffold never creates"
fi
want "installs from the lockfile (pnpm install --frozen-lockfile)" \
     '^[[:space:]]*-[[:space:]]*run:[[:space:]]*pnpm install --frozen-lockfile[[:space:]]*$'
want "type-checks" '(run:.*type-check)'
want "lints (tolerating a starter without a lint script)" '(run:.*pnpm run (--if-present )?lint)'
want "builds"      '(run:.*pnpm run build)'
want "runs on pull_request, not only on push" '^[[:space:]]*pull_request:'
want "declares a concurrency group" '^concurrency:'

# ── the test can still fail ───────────────────────────────────────────────────
# A checker whose patterns stopped matching passes exactly as quietly as a
# correct template. Prove on a fixture that the cache assertion still fires.
probe="$(printf 'jobs:\n  verify:\n    steps:\n      - run: npm ci\n')"
if grep -qE '^[[:space:]]*path:[[:space:]]*\.next/cache' <<< "$probe"; then
  bad "the cache check matched a template that has NO cache — it is inert"
else
  ok "the cache check rejects a template without a cache"
fi

# ── pnpm and Node must stay in lockstep ──────────────────────────────────────
#
# pnpm 11 imports node:sqlite, which does not exist before Node 22.13. The
# scaffold's .nvmrc said 20 — fine while CI used npm, fatal the moment it used
# pnpm, and the first scaffolded site's CI died on it:
#
#   Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
#
# fleet/templates/ci/ci-pnpm.yml already carries this constraint in a comment.
# It was written down and diverged anyway, which is the argument for asserting.
NVMRC="$HERE/../site-template/.nvmrc"
if [ ! -f "$NVMRC" ]; then
  bad "no .nvmrc — CI pins Node from it"
else
  node_major="$(tr -dc '0-9.' < "$NVMRC" | cut -d. -f1)"
  if grep -q "pnpm" <<< "$src" && [ "${node_major:-0}" -lt 22 ]; then
    bad "CI uses pnpm but .nvmrc pins Node $node_major — pnpm 11 needs >= 22.13"
  else
    ok "Node floor (.nvmrc = $node_major) satisfies the package manager CI uses"
  fi
fi

# ── the package.json the scaffold emits ──────────────────────────────────────
#
# pnpm 11 refuses to run a dependency's build script unless approved, and EXITS
# NON-ZERO. The approval must live in pnpm-workspace.yaml: package.json's "pnpm"
# field is no longer read, so an approval written there is PRESENT AND INERT and
# a checker grepping package.json passes while install still exits 1.
PKG="$HERE/../site-template/package.json"
if [ ! -f "$PKG" ]; then
  bad "the scaffold ships no package.json"
else
  pkg="$(cat "$PKG")"
  if grep -q '"pnpm"[[:space:]]*:' <<< "$pkg"; then
    bad "package.json has a \"pnpm\" field — pnpm 11 ignores it; use pnpm-workspace.yaml"
  else
    ok "no inert \"pnpm\" field in package.json"
  fi

  WS="$HERE/../site-template/pnpm-workspace.yaml"
  if [ ! -f "$WS" ]; then
    bad "no pnpm-workspace.yaml — pnpm install exits 1 on sharp/unrs-resolver"
  elif grep -qE '^[[:space:]]+(sharp|unrs-resolver):[[:space:]]*true' "$WS"; then
    ok "approves the build scripts pnpm 11 would otherwise refuse"
  else
    bad "pnpm-workspace.yaml does not approve sharp/unrs-resolver builds"
  fi
  if grep -q '"packageManager"' <<< "$pkg"; then
    ok "pins packageManager so the deploy does not use whatever is on PATH"
  else
    bad "no packageManager pin"
  fi
fi

# ── the day-zero page ────────────────────────────────────────────────────────
#
# Every site this scaffold creates serves app/page.tsx until its owner replaces
# it, so that page is not scaffolding — it is what a client sees the moment they
# are told their site is live, and sometimes the only page of ours they ever
# see. It used to render a note to the developer ("This is a new site scaffolded
# by new-site.sh. Replace this page"), which is a TODO left on a public URL
# under someone else's name.
PAGE="$HERE/../site-template/app/page.tsx"
if [ ! -f "$PAGE" ]; then
  bad "the scaffold ships no app/page.tsx"
else
  page="$(cat "$PAGE")"

  # The one thing this page must do: send its owner somewhere they can change
  # the site themselves. A day-zero page with no way forward makes the studio
  # the only route to a change, which is the dependency the widget, the repo
  # and this whole scaffold exist to remove.
  if grep -q 'loki\.orangecat\.ch' <<< "$page"; then
    ok "the day-zero page routes its owner to Loki"
  else
    bad "the day-zero page has no route to Loki — a dead end for its owner"
  fi

  # Instructions to a developer, rendered at a client. Checked in the JSX only:
  # the file's own comments explain why this rule exists and must be allowed to
  # name what they forbid, or the rule can only survive by being deleted.
  jsx="$(printf '%s\n' "$page" | sed 's|//.*||' | sed '/^\s*\*/d; /\/\*/,/\*\//d')"
  if grep -qE 'new-site\.sh|Replace this page' <<<"$jsx"; then
    bad "the day-zero page renders build instructions at the visitor"
  else
    ok "the day-zero page addresses its owner, not its developer"
  fi

  # OrangeCat is where the project is public and followable. It is NOT where the
  # building happens, so it is a secondary text link and never the button —
  # asserted both ways, because "links to OrangeCat" is satisfied just as well
  # by a page that makes it the primary action, which is the wrong product.
  if grep -q 'orangecat\.ch' <<< "$page"; then
    ok "the day-zero page also links OrangeCat"
  else
    bad "no OrangeCat link — the project is public there and nothing points at it"
  fi
  if printf '%s\n' "$jsx" | grep -B2 'bg-accent[^-]' | grep -q 'ocHref'; then
    bad "the OrangeCat link is styled as the primary action — Loki is the primary"
  else
    ok "the primary action is Loki; OrangeCat stays secondary"
  fi

  # HONESTY. The page claims "you can change it from this page", which is only
  # true if the widget is actually on the page — and layout.tsx renders that
  # script on NEXT_PUBLIC_FC_WIDGET_TOKEN. Diplodoctor shipped the claim WITHOUT
  # the widget, because provisioning failed non-fatally and nothing tied the
  # sentence to the fact. A claim must be gated on the same value as the thing
  # it describes.
  if grep -q 'change it from here' <<< "$jsx"; then
    if grep -q 'NEXT_PUBLIC_FC_WIDGET_TOKEN' <<< "$page"; then
      ok "the 'edit from this page' claim is gated on the widget actually shipping"
    else
      bad "the page claims it can be edited in place without checking the widget token"
    fi
  else
    ok "no ungated in-place-editing claim"
  fi
fi

# ── contrast is arithmetic, not a grep ───────────────────────────────────────
#
# An earlier version of this asserted the SHAPE of one palette: "the dark scheme
# must override --color-accent-fg and must NOT override --color-accent". True of
# the blue placeholder, and WRONG the moment the template adopted Loki's
# monochrome action, which inverts by design. It would have failed a correct
# palette. The property that does not change is the ratio, so compute it.
CSS="$HERE/../site-template/app/globals.css"
if [ ! -f "$CSS" ]; then
  bad "the scaffold ships no app/globals.css"
else
  if node "$HERE/check-template-contrast.mjs" > /tmp/tpl-contrast.$$ 2>&1; then
    ok "every token pair meets AA in both colour schemes (real WCAG ratios)"
  else
    bad "token pairs below AA:"
    sed 's/^/      /' /tmp/tpl-contrast.$$
  fi
  rm -f /tmp/tpl-contrast.$$

  # The palette must belong to something we own. The template shipped an
  # invented mid-blue matching neither Loki nor OrangeCat, and a site
  # sitting in it read as generated rather than new.
  #
  # COMMENT-AWARE, and this check taught itself the lesson twice: globals.css
  # explains in its own header WHY that blue was removed, and the first version
  # of this rule failed on that sentence. A gate that cannot tolerate its own
  # rule being written down forces the explanation to be deleted, which is how
  # the reason for a decision disappears.
  #
  # THE SECOND LESSON WAS WORSE. The stripper was
  #     sed 's|/\*|\n&|g' | sed '/\/\*/,/\*\//d'
  # and a sed range NEVER matches its end address on the start line. A one-line
  # `/* ... */` therefore opens a range that runs to the NEXT comment, deleting
  # every live declaration in between — including the primitive that holds the
  # blue. Run against the real template it was written to catch, the gate passed:
  # it had eaten the evidence. It only ever "worked" on a file with no blue.
  #
  # perl strips a comment as a comment, non-greedily, across lines.
  css_live="$(perl -0777 -pe 's{/\*.*?\*/}{}gs' "$CSS")"
  if grep -q '#4a6fa5' <<< "$css_live"; then
    bad "globals.css still DECLARES the invented placeholder blue"
  else
    ok "no invented placeholder colour in any live declaration"
  fi

  # The stripper needs its OWN proof, in both directions. "Does not find the
  # blue" is satisfied just as well by a stripper that deleted the whole file,
  # which is precisely the bug above.
  probe="$(printf '/* explaining #4a6fa5 */\n  --kept: #abcdef;\n/* second comment */\n  --also-kept: #123456;\n')"
  stripped="$(printf '%s' "$probe" | perl -0777 -pe 's{/\*.*?\*/}{}gs')"
  if grep -q '4a6fa5' <<< "$stripped"; then
    bad "the comment stripper leaves commented colours behind — the rule cannot be written down"
  elif ! grep -q 'abcdef' <<< "$stripped" || ! grep -q '123456' <<< "$stripped"; then
    bad "the comment stripper EATS live declarations between comments — it would hide the defect"
  else
    ok "the comment stripper drops comments and keeps every declaration"
  fi

  if grep -q '#4a6fa5' <<< "--color-accent: #4a6fa5;"; then
    ok "the placeholder-colour check still matches a real declaration"
  else
    bad "the placeholder-colour check is inert"
  fi
fi

# ── a non-fatal failure must still be visible at the end ─────────────────────
#
# Diplodoctor shipped with NO feedback widget. Provisioning needs the Loki
# database, it was unreachable from the laptop, the step is non-fatal by design,
# and its warning then scrolled off the top of a run that went on to build a
# repo, a box, a deploy and a live site. Nothing was broken; nothing reported it
# either. It surfaced only when the live HTML was read.
#
# So the warning is carried into the closing summary. Both halves are asserted:
# a message that is assembled and never printed fails exactly as silently as the
# failure it describes.
NS="$HERE/new-site.sh"
if [ ! -f "$NS" ]; then
  bad "no new-site.sh"
else
  # WHERE it provisions decides WHETHER it provisions. Production Loki is
  # 127.0.0.1/loki — loopback only — so running provision-widget.ts from
  # the laptop fails on every scaffold, and from an agent worktree it fails
  # before the network (gitignored .env.local). Every agent-created site up to
  # 2026-09-11 shipped with no widget because of it. Assert the box path, and
  # assert the absence of the local one: adding the good call back while leaving
  # the old one in place would look correct and still take the broken branch.
  ns_live="$(sed 's/#.*//' "$NS")"
  if grep -q 'provision-widget-on-box.sh' <<< "$ns_live"; then
    ok "the widget is provisioned ON THE BOX, where the database actually is"
  else
    bad "new-site.sh does not use provision-widget-on-box.sh — prod Loki is loopback-only"
  fi
  if grep -qE 'npx tsx .*scripts/provision-widget\.ts' <<< "$ns_live"; then
    bad "new-site.sh still calls provision-widget.ts locally — that cannot reach prod"
  else
    ok "no local provision-widget.ts call left to fall back to"
  fi

  PWB="$HERE/provision-widget-on-box.sh"
  if [ ! -f "$PWB" ]; then
    bad "provision-widget-on-box.sh is missing"
  else
    # The older provisioner writes its token with NO trailing newline, and a
    # bare `while read` drops an unterminated final line — silently discarding
    # the one value the script exists to read, then reporting "no token" for a
    # run that succeeded.
    if grep -q 'read -r line || \[ -n "\$line" \]' "$PWB"; then
      ok "the fragment reader keeps an unterminated final line"
    else
      bad "the fragment reader drops a token written without a trailing newline"
    fi
    # A half fragment (project id, no token) would look like success and leave
    # the site with a widget that cannot authenticate.
    if grep -q 'no token in output' "$PWB"; then
      ok "it refuses to emit a fragment with no token"
    else
      bad "it can emit a token-less fragment, which reads as success"
    fi
  fi

  if grep -q 'WIDGET_TODO=' "$NS"; then
    ok "a failed widget provision is recorded for the summary"
  else
    bad "a failed widget provision is only warned about mid-run, where it scrolls away"
  fi
  if grep -qE '^\$\{WIDGET_TODO\}$' "$NS"; then
    ok "the summary interpolates it, so it reaches the operator"
  else
    bad "WIDGET_TODO is assembled but never printed in the summary"
  fi
  # The repair it prints has to work. Appending to .env.selfhost.local is enough
  # only before the FIRST deploy: deploy.sh seeds /opt/<name>/shared/.env from
  # that file only when the box has none, and NEXT_PUBLIC_* is inlined at BUILD
  # time. Without a --env redeploy the advice is a no-op that looks like a fix.
  if grep -q 'deploy.sh $SLUG --env' "$NS"; then
    ok "the repair pushes the value to the box, which is the env SSOT"
  else
    bad "the repair only edits a local file — after the first deploy that changes nothing"
  fi
fi

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ] || {
  echo
  echo "The scaffold emits this file into every new site. A gap here is not one"
  echo "broken repo — it is every repo created from now on, and the fleet ratchet"
  echo "will report it once per repo rather than once."
  exit 1
}
