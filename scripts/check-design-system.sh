#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0
checks_run=0

# This gate silently passed for its entire life: `rg` is not installed on the
# GitHub runner, so every `if rg ...` saw exit 127 — indistinguishable from
# "no matches" — and the script printed "ok" while scanning nothing. A gate
# that cannot tell "tool missing" from "clean" is worse than no gate, because
# it manufactures confidence. Fail loudly instead.
if ! command -v rg >/dev/null 2>&1; then
  echo "design-system check FAILED: ripgrep (rg) is not installed." >&2
  echo "This gate scans nothing without it. Install ripgrep in CI and locally." >&2
  exit 1
fi

check_none() {
  local label="$1"
  local pattern="$2"
  shift 2
  local files=("$@")

  checks_run=$((checks_run + 1))

  # rg exits 0 on match, 1 on no-match, >1 on error. Only exit 1 means clean —
  # anything else (bad glob, unreadable path) must not read as a pass.
  local out status
  out="$(rg -n "$pattern" "${files[@]}" 2>&1)" && status=0 || status=$?

  if [[ "$status" -eq 0 ]]; then
    echo "$out"
    echo
    echo "design-system check failed: $label"
    fail=1
  elif [[ "$status" -ne 1 ]]; then
    echo "design-system check ERRORED (rg exit $status) on: $label" >&2
    echo "$out" >&2
    fail=1
  fi
}

check_none "custom ui-* classes used inside @apply in TSX" '@apply .*ui-' src/components src/app -g '*.tsx'
check_none "raw shared search input recipe outside primitive" 'w-full rounded-2xl border border-border-default bg-surface-overlay .*pl-11 .*pr-16' src/components src/app -g '!src/app/globals.css'
check_none "raw code-surface recipe outside primitive" 'rounded-\[1\.5rem\] border border-border-subtle bg-surface-overlay p-4 .*leading-relaxed text-text-secondary' src/components src/app -g '!src/app/globals.css'
check_none "raw subtle link text recipe outside primitive" 'text-xs text-text-tertiary .*hover:text-text-secondary' src/components src/app -g '!src/app/globals.css'

# Layer 4: JSX must not use raw palette or white-opacity utilities — auth/public
# tokens live in globals.css ui-auth-* / ui-public-* / ui-brand-* classes.
check_none "raw palette colors in components" 'text-gray-|text-slate-|text-zinc-|text-blue-|text-green-|text-red-|text-purple-|text-yellow-|text-orange-|text-cyan-|text-violet-|bg-gray-|bg-blue-|bg-green-|bg-red-|bg-\[#|text-\[#|text-\[1[0-9]px\]|text-\[8px\]' src/components src/app -g '*.tsx' -g '!**/opengraph-image.tsx'
check_none "raw white opacity utilities in JSX" 'text-white/|bg-white/|border-white/' src/components src/app -g '*.tsx' -g '!**/opengraph-image.tsx'

# `--accent` / `--accent-foreground` are shadcn's accent SURFACE pair: --accent
# is a background tone (oklch 0.14 in dark, 0.96 in light), so `text-accent`
# paints text the same colour as the panel behind it. Measured in a real
# browser: contrast ratio 1.0 in dark and 1.03 in light — the Control
# onboarding CTAs ("No install needed →", "Download for your OS →") were
# literally invisible in both themes. `border-accent` failed the same way as a
# hover highlight, and `bg-accent` as a selected-checkbox fill.
# Use the semantic text/line tokens instead: text-accent-text,
# border-accent-primary, or the filled pair bg-accent-warm + text-on-accent.
# `bg-accent` as a genuine hover SURFACE is the one legitimate use and is
# spelled bg-surface-raised here, so nothing needs the bare name.
check_none "shadcn accent-surface token used as a text/line colour" \
  '(text|fill|stroke|border|ring|bg)-accent([^a-zA-Z0-9_-]|$)' \
  src/components src/app -g '*.tsx'

# THE TOUCH FLOOR is declared once, in globals.css, keyed on `pointer: coarse`.
# `min-h-11 sm:min-h-0` (and sm:min-h-7/-8/-9, lg:min-h-0 …) is the OLD form and
# is a bug, not a style preference: it drops the 44px minimum at a viewport
# WIDTH, so a tablet — a touch device that happens to be 768px wide — inherits
# desktop sizing. The audit measured 23-32px targets there. Width never told you
# whether the user has a finger or a mouse; `pointer` does.
# Fix: delete the min-h/min-w pair and add the class to the floor in globals.css,
# or put `ui-tap` / `ui-tap-icon` on a one-off control.
# Matches only the defective SHAPE: a 44px base paired with a responsive
# override. Plain responsive sizing (a textarea that grows on wide screens) is
# not a touch target and is deliberately not flagged.
check_none "viewport-keyed touch target (use the pointer:coarse floor in globals.css)" \
  'min-(h|w)-11[^"]*(sm|md|lg|xl):min-(h|w)-[0-9]|(sm|md|lg|xl):min-(h|w)-[0-9][^"]*min-(h|w)-11' \
  src/components src/app

# The inverse of check_none: some rules are about what MUST be there. A styled
# active nav item that never announces itself is a highlight only sighted users
# get, and it is invisible to every check that only looks for forbidden strings.
check_paired() {
  local label="$1"
  local trigger="$2"   # if a file contains this...
  local required="$3"  # ...it must also contain this
  shift 3

  checks_run=$((checks_run + 1))

  local triggered status
  triggered="$(rg -l "$trigger" "$@" 2>&1)" && status=0 || status=$?

  # No file triggers the rule: nothing to check, but say so — a rule that
  # matches nothing must not read the same as a rule that passed.
  if [[ "$status" -eq 1 ]]; then
    echo "design-system check WARNING: no file matches trigger for: $label" >&2
    return
  fi
  if [[ "$status" -ne 0 ]]; then
    echo "design-system check ERRORED (rg exit $status) on: $label" >&2
    echo "$triggered" >&2
    fail=1
    return
  fi

  local offenders=()
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    rg -q "$required" "$file" || offenders+=("$file")
  done <<< "$triggered"

  if [[ "${#offenders[@]}" -gt 0 ]]; then
    printf '%s\n' "${offenders[@]}"
    echo
    echo "design-system check failed: $label"
    fail=1
  fi
}

# Styling the active nav item without announcing it means the highlight exists
# only for people who can see it. This shape is not hypothetical: a fleet-wide
# nav audit found the desktop sidebar here styling `ui-nav-item-active` and
# staying silent, while MobileNav, MobileNavSheet and FleetSurfaceGuide all set
# aria-current correctly. Four surfaces right, one wrong, is what applying a
# rule by hand looks like — so the rule stops being applied by hand.
check_paired "active nav styling without aria-current" \
  'ui-nav-item-active' 'aria-current' \
  src/components src/app -g '*.tsx'

# A class name is the one part of a component that nothing else checks. A
# reference to a rule that was renamed or deleted still typechecks, still
# lints, still builds, and still renders — as unstyled markup. Both directions
# matter: a missing rule is a broken component, an unused rule is dead weight
# that the next person reads as load-bearing.
checks_run=$((checks_run + 1))
if ! node scripts/check-loki-classes.mjs; then
  fail=1
fi

# The same question asked of every OTHER ui-* rule, as a ratchet rather than a
# hard zero — there are 35 rules nothing references, and a check that fails on
# day one is a check that gets switched off on day two. It may only go down.
# Dead CSS matters more here than most places: this repo's Layer 3 contract
# says the named class IS the design decision, so an unused rule does not read
# as dead, it reads as the house style.
checks_run=$((checks_run + 1))
if ! node scripts/check-ui-classes.mjs; then
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

# Print what was actually scanned: "0 checks run" must look different from
# "0 violations found" at a glance.
echo "design-system check: ok ($checks_run checks run)"
