#!/usr/bin/env bash
# Copy user-owned rows from one Postgres database to another, rewriting user_id.
# Vendor-neutral — works for local→remote, box→box, etc.
#
# Usage:
#   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... TARGET_USER_ID=<uuid> \
#     ./scripts/db/sync-user-data.sh [--dry-run] [--force]
#
# Env vars:
#   SOURCE_DATABASE_URL  Source (defaults to local cockpit Postgres)
#   TARGET_DATABASE_URL  Target direct URL. REQUIRED.
#   SOURCE_USER_ID       Source user_id to rewrite (default: dev seed UUID)
#   TARGET_USER_ID       Target user_id in destination. REQUIRED.
#
# Legacy aliases (still accepted): LOCAL_DATABASE_URL, LOCAL_USER_ID
#
# Prerequisites: psql + pg_dump in PATH.

set -euo pipefail

SOURCE_URL="${SOURCE_DATABASE_URL:-${LOCAL_DATABASE_URL:-postgresql://cockpit:cockpit_local@127.0.0.1:5432/cockpit}}"
TARGET_URL="${TARGET_DATABASE_URL:-}"
SOURCE_USER_ID="${SOURCE_USER_ID:-${LOCAL_USER_ID:-00000000-0000-0000-0000-000000000001}}"
TARGET_USER_ID="${TARGET_USER_ID:-}"

if [ -z "$TARGET_URL" ]; then
  echo "ERROR: set TARGET_DATABASE_URL before running." >&2
  exit 2
fi

if [ -z "$TARGET_USER_ID" ]; then
  echo "ERROR: set TARGET_USER_ID to the destination user's UUID." >&2
  echo "Find it via: psql \"\$TARGET_DATABASE_URL\" -c \"SELECT id, email FROM users\"" >&2
  exit 2
fi

DRY_RUN=false
FORCE=false
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
  [[ "$arg" == "--force" ]]   && FORCE=true
done

echo "=== Postgres user-data sync ==="
echo "  Source user_id : $SOURCE_USER_ID"
echo "  Target user_id : $TARGET_USER_ID"
$DRY_RUN && echo "  MODE: DRY RUN (no writes to target)"
echo ""

TABLES=(
  orgs
  org_memberships
  entities
  attributes
  entity_relations
  interactions
  alerts
  user_projects
  goals
  subscriptions
  commitments
  events
  actions
  habits
  habit_completions
  orchestration_runs
  orchestration_events
  project_states
  prompt_history
  pending_commands
)

echo "Verifying target connection..."
TARGET_USER_COUNT=$(psql "$TARGET_URL" -t -c "SELECT count(*) FROM users;" 2>/dev/null | tr -d ' \n')
[[ -z "$TARGET_USER_COUNT" || "$TARGET_USER_COUNT" == "0" ]] && { echo "ERROR: target users table empty or unreachable."; exit 1; }
echo "  Target users: $TARGET_USER_COUNT ✓"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

IMPORTED=0
SKIPPED=0

for t in "${TABLES[@]}"; do
  SOURCE_COUNT=$(psql "$SOURCE_URL" -t -c "SELECT count(*) FROM $t;" 2>/dev/null | tr -d ' \n')
  TARGET_COUNT=$(psql "$TARGET_URL" -t -c "SELECT count(*) FROM $t;" 2>/dev/null | tr -d ' \n')

  if [[ "$SOURCE_COUNT" == "0" ]]; then
    echo "  $t: 0 rows — skip"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ "$TARGET_COUNT" != "0" && "$FORCE" == "false" ]]; then
    echo "  $t: already has $TARGET_COUNT rows — skip (--force to overwrite)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo -n "  $t: $SOURCE_COUNT rows — "

  COPY_FILE="$TMPDIR/${t}.copy"

  pg_dump "$SOURCE_URL" \
    --table="$t" \
    --data-only \
    --no-comments \
    --no-owner \
    --no-privileges \
    2>/dev/null \
  | awk '/^COPY /,/^\\./' \
  | sed "s/$SOURCE_USER_ID/$TARGET_USER_ID/g" \
  > "$COPY_FILE"

  if $DRY_RUN; then
    echo "would import (dry run)"
    head -3 "$COPY_FILE"
    continue
  fi

  if [[ "$TARGET_COUNT" != "0" && "$FORCE" == "true" ]]; then
    psql "$TARGET_URL" -c "TRUNCATE TABLE $t CASCADE;" 2>/dev/null
  fi

  RESULT=$(psql "$TARGET_URL" -f "$COPY_FILE" 2>&1)
  if grep -q "^COPY" <<<"$RESULT"; then
    ROWS=$(echo "$RESULT" | grep "^COPY" | awk '{print $2}')
    echo "imported $ROWS rows ✓"
    IMPORTED=$((IMPORTED + 1))
  else
    echo "ERROR"
    echo "$RESULT" | head -5
  fi
done

echo ""
echo "=== Verification ==="
psql "$TARGET_URL" -c "
SELECT 'entities' as t, count(*) FROM entities
UNION ALL SELECT 'user_projects', count(*) FROM user_projects
UNION ALL SELECT 'goals', count(*) FROM goals
UNION ALL SELECT 'subscriptions', count(*) FROM subscriptions
UNION ALL SELECT 'commitments', count(*) FROM commitments
UNION ALL SELECT 'events', count(*) FROM events
UNION ALL SELECT 'interactions', count(*) FROM interactions
UNION ALL SELECT 'prompt_history', count(*) FROM prompt_history
UNION ALL SELECT 'orchestration_events', count(*) FROM orchestration_events
ORDER BY t;" 2>/dev/null

echo ""
echo "Done: $IMPORTED tables imported, $SKIPPED skipped."
