#!/usr/bin/env bash
# Behavioural test for scripts/hetzner/launch.sh.tmpl.
#
# This does NOT grep the template for "pwd -P" — a gate that asserts a string is
# present passes for a hundred wrong reasons and proves nothing about behaviour.
# It builds the real /opt layout (a release directory plus an `app` SYMLINK into
# it, which is what the box actually has) and checks that the template's own
# server.js discovery finds the file through that symlink.
#
# Mutate `pwd -P` back to `pwd` in the template and this test must go red. That
# is the whole point: the plain-`pwd` version is what crash-looped vitareba
# (2026-07-17) and sbb-fundbuero (2026-09-08), and both times it was invisible
# until an app failed to boot in production.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMPL="$HERE/launch.sh.tmpl"
fails=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name" >&2
    echo "      expected: $expected" >&2
    echo "      actual:   $actual" >&2
    fails=$((fails + 1))
  fi
}

echo "launch.sh.tmpl: behavioural checks"

[ -f "$TMPL" ] || { echo "✗ $TMPL missing" >&2; exit 1; }

# --- Fixture: the releases layout, exactly as deploy.sh builds it on the box ---
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/releases/r1/.next" "$work/shared" "$work/releases/r1/node_modules/next/dist"
echo '// real entrypoint'  > "$work/releases/r1/server.js"
# A decoy inside node_modules: the search must skip it, or a deploy would boot
# the framework's own server instead of the app's.
echo '// decoy'            > "$work/releases/r1/node_modules/next/dist/server.js"
ln -s "$work/releases/r1" "$work/app"

# Render the template the way sync-infra.sh does, and install it the way the box
# has it: the real file in shared/, reached through a symlink in the release.
sed "s|__PORT__|4099|g" "$TMPL" > "$work/shared/launch.sh"
chmod +x "$work/shared/launch.sh"
ln -s "$work/shared/launch.sh" "$work/releases/r1/launch.sh"

# --- 1. Does it find server.js at all, invoked through the app symlink? ---
# Run the template with node/exec stubbed out so it reports what it WOULD run.
stub="$work/stub"; mkdir -p "$stub"
cat > "$stub/node" <<'STUB'
#!/usr/bin/env bash
echo "WOULD_RUN=$1"
STUB
chmod +x "$stub/node"

# The template hardcodes /usr/bin/node, so rewrite just that for the test.
sed 's|/usr/bin/node|node|' "$work/shared/launch.sh" > "$work/shared/launch-test.sh"
chmod +x "$work/shared/launch-test.sh"
ln -sf "$work/shared/launch-test.sh" "$work/releases/r1/launch-test.sh"

resolved="$(PATH="$stub:$PATH" bash "$work/app/launch-test.sh" 2>&1 || true)"
check "finds server.js through the app symlink" \
      "WOULD_RUN=$work/releases/r1/server.js" \
      "$(echo "$resolved" | grep '^WOULD_RUN=' || echo "$resolved")"

# --- 2. Does it skip the node_modules decoy? ---
if grep -q 'node_modules' <<<"$resolved"; then
  echo "  ✗ picked a server.js inside node_modules" >&2
  fails=$((fails + 1))
else
  echo "  ✓ skips node_modules"
fi

# --- 3. Is the port substituted? ---
check "substitutes __PORT__" "1" \
      "$(grep -c 'PORT=4099' "$work/shared/launch.sh")"
check "leaves no __PORT__ placeholder" "0" \
      "$(grep -c '__PORT__' "$work/shared/launch.sh" || true)"

# --- 4. The negative control: prove this test can actually fail. ---
# Build the same fixture with the pre-fix `pwd` and assert discovery BREAKS. If
# this ever passes, the test has stopped testing anything and every check above
# is decorative.
sed 's|&& pwd -P)|\&\& pwd)|; s|/usr/bin/node|node|' "$TMPL" \
  | sed "s|__PORT__|4099|g" > "$work/shared/launch-broken.sh"
chmod +x "$work/shared/launch-broken.sh"
ln -sf "$work/shared/launch-broken.sh" "$work/releases/r1/launch-broken.sh"
broken="$(PATH="$stub:$PATH" bash "$work/app/launch-broken.sh" 2>&1 || true)"

if grep -q '^WOULD_RUN=' <<<"$broken"; then
  echo "  ✗ negative control: plain 'pwd' still found server.js —" >&2
  echo "    this test cannot detect the regression it exists for" >&2
  fails=$((fails + 1))
else
  echo "  ✓ negative control: plain 'pwd' fails to find server.js"
fi

if [ "$fails" -gt 0 ]; then
  echo "launch.sh.tmpl: $fails check(s) FAILED" >&2
  exit 1
fi
echo "launch.sh.tmpl: ok"
