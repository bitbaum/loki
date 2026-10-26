#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/producer/scripts/ci" "$fixture/source checkout/apps/web" "$fixture/stage/apps/web/public/.well-known"
export FLEET_RECEIPT_ROOT="$fixture/producer" FLEET_RECEIPT_REPO=bitbaum/example
receipt="$fixture/stage/apps/web/public/.well-known/fleet-release.json"
cat > "$fixture/producer/scripts/ci/release-receipt.mjs" <<'JS'
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
writeFileSync(option('--output'), JSON.stringify({ root: option('--root'), project: option('--dir'), repo: option('--repo'), projects: option('--projects') ?? null, public: args.includes('--public') }));
JS
run() { bash "$here/stage-release-receipt.sh" "$fixture/source checkout" "$fixture/source checkout/apps/web" "$fixture/stage/apps/web"; }
export FLEET_RECEIPT_PUBLIC=true
run
node - "$receipt" "$fixture/source checkout" <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const result = JSON.parse(fs.readFileSync(process.argv[2]));
assert.equal(result.root, process.argv[3]);
assert.equal(result.project, process.argv[3] + '/apps/web');
assert.equal(result.repo, 'bitbaum/example');
assert.equal(result.public, true);
assert.equal(result.projects, null);
JS
export FLEET_RECEIPT_PROJECTS='apps/web,packages/ai'
run
node - "$receipt" <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(JSON.parse(fs.readFileSync(process.argv[2])).projects, 'apps/web,packages/ai');
JS
unset FLEET_RECEIPT_PROJECTS
for visibility in false unknown ''; do
  printf '{"old":"must not remain"}\n' > "$receipt"
  export FLEET_RECEIPT_PUBLIC="$visibility"
  run
  test ! -e "$receipt"
done
export FLEET_RECEIPT_PUBLIC=true
printf 'process.exit(9);\n' > "$fixture/producer/scripts/ci/release-receipt.mjs"
printf '{"old":"must not remain"}\n' > "$receipt"
run
test ! -e "$receipt"
rm "$fixture/producer/scripts/ci/release-receipt.mjs"
run
test ! -e "$receipt"
echo 'stage-release-receipt: public/nested paths, privacy, missing producer and failure passed'
