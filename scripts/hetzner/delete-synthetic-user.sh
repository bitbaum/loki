#!/usr/bin/env bash
#
# Delete one synthetic account from OrangeCat's auth server (GoTrue in the
# self-hosted Supabase), by its exact email.
#
# WHY
# ---
# Live checks sign up throwaway accounts. When a run dies halfway, its account
# stays behind with nobody holding the password, and only the GoTrue admin API
# can remove it (orangecat#1533 left one). This is that removal, and nothing
# more: the address is checked first, the user is found by an exact match of
# the email, deleted with DELETE /auth/v1/admin/users/<id>, and the lookup is
# repeated to prove it is gone.
#
# Only reserved, never-deliverable domains are accepted: example.com,
# example.test (RFC 2606 / 6761) and anything under .invalid. A real person's
# address is refused before the box is asked anything.
#
# Runs ON THE BOX (sudo reads the service-role key from Supabase's .env).
# Prints the address, the user id and verdicts; never a key.
#
# Usage:
#   delete-synthetic-user.sh show   <email>   # find it; changes nothing
#   delete-synthetic-user.sh delete <email>   # find it, delete it, read back
#
# Overridable for tests (test-delete-synthetic-user.sh): SUPABASE_DIR,
# AUTH_URL, SUDO.
set -euo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase/docker}"
ENV_FILE="$SUPABASE_DIR/.env"
SUDO="${SUDO-sudo}"
AUTH_URL="${AUTH_URL:-https://supabase.orangecat.ch/auth/v1}"

die() { echo "✗ $*" >&2; exit 1; }

action="${1:-}"; email="${2:-}"
case "$action" in show|delete) ;; *) die "usage: $0 show|delete <email>" ;; esac
[ -n "$email" ] || die "usage: $0 show|delete <email>"

# The address itself, before anything else: one local part, one domain, the
# domain reserved.
email=$(tr '[:upper:]' '[:lower:]' <<<"$email")
[[ "$email" =~ ^[a-z0-9._%+-]+@([a-z0-9-]+\.)*[a-z0-9-]+$ ]] || die "not an email address: $email"
domain="${email#*@}"
case "$domain" in
  example.com|example.test|invalid|*.invalid) ;;
  *) die "refused: $domain is not example.com, example.test or .invalid; only synthetic accounts are deleted here" ;;
esac

key=$($SUDO sed -nE 's/^SERVICE_ROLE_KEY=["'\'']?([^"'\'']+).*/\1/p' "$ENV_FILE" | tail -1)
[ -n "$key" ] || die "no SERVICE_ROLE_KEY in $ENV_FILE"

# python3 does the HTTP so the key goes through stdin, never argv or the log.
printf '%s' "$key" | ACTION="$action" EMAIL="$email" AUTH_URL="$AUTH_URL" python3 -c '
import json, os, sys, urllib.request, urllib.error
key = sys.stdin.read().strip()
base, email, action = os.environ["AUTH_URL"].rstrip("/"), os.environ["EMAIL"], os.environ["ACTION"]
H = {"apikey": key, "Authorization": "Bearer " + key}

def call(method, path):
    req = urllib.request.Request(base + path, method=method, headers=H)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        return e.code, None

def find():
    hits, page = [], 1
    while True:
        status, data = call("GET", "/admin/users?page=%d&per_page=500" % page)
        if status != 200:
            sys.exit("✗ listing users answered HTTP %d" % status)
        users = (data or {}).get("users") or []
        hits += [u["id"] for u in users if (u.get("email") or "").lower() == email]
        if len(users) < 500:
            return hits
        page += 1

hits = find()
if len(hits) > 1:
    sys.exit("✗ %d users have %s; refusing to choose" % (len(hits), email))
if not hits:
    print("✓ no user has %s; nothing to delete" % email)
    sys.exit(0)
uid = hits[0]
print("found %s: %s" % (email, uid))
if action == "show":
    sys.exit(0)
status, _ = call("DELETE", "/admin/users/" + uid)
if status not in (200, 204):
    sys.exit("✗ delete answered HTTP %d" % status)
if find():
    sys.exit("✗ %s is still listed after delete" % email)
status, _ = call("GET", "/admin/users/" + uid)
if status != 404:
    sys.exit("✗ user %s still answers HTTP %d after delete" % (uid, status))
print("✓ deleted %s (%s); it is gone" % (email, uid))
'
