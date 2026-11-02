#!/usr/bin/env bash
# runtime-conformance-audit.sh — check the RUNNING system, not the source.
#
# WHY THIS EXISTS. bitbaum/fleet already has hosted-supabase-audit.sh, whose
# stated job is "does any repo still point at a Supabase we retired?". It ran on
# 2026-08-28 and reported SUCCESS while printcraft's production API returned 500,
# because it pointed at a hosted project whose DNS no longer resolved.
#
# It missed because it runs `git grep` over repo checkouts, and the reference
# lived in /opt/printcraft/shared/.env — not in git, deliberately, because the
# box is the environment SSOT. The gate was scoped to the wrong substrate: it
# checked the artifact while the configuration lived in the running system.
#
# So the rule this file implements: SOURCE audits run in CI against git;
# RUNTIME audits run here against what is actually deployed. The fleet had a
# good collection of the first kind and none of the second.
#
# Read-only. Prints one line per finding, exits 1 if any. Never prints a secret.
set -u
export LC_ALL=C

BOX_NODE="$(node --version 2>/dev/null | tr -d 'v')"
BOX_NODE_MAJOR="${BOX_NODE%%.*}"
findings=0
unreadable=0

note() { printf '%s\n' "$*"; }
finding() { findings=$((findings+1)); printf 'FINDING|%s|%s\n' "$1" "$2"; }
cannot()  { unreadable=$((unreadable+1)); printf 'UNREADABLE|%s|%s\n' "$1" "$2"; }

# Hosts we have deliberately left. A managed service we no longer pay for is
# not a dependency we still want discovered by an outage.
RETIRED_RE='supabase\.co|neon\.tech|planetscale\.com|railway\.app|render\.com|\.vercel-storage\.com'

for dir in /opt/*/; do
  app="$(basename "$dir")"
  case "$app" in _appcron|backups|monitoring|supabase) continue ;; esac

  env=""
  for cand in "$dir/shared/.env" "$dir/app/.env"; do
    [ -f "$cand" ] && { env="$cand"; break; }
  done
  [ -n "$env" ] || continue
  [ -r "$env" ] || { cannot "$app" "env not readable: $env"; continue; }

  # ---- 1. a retired managed host still referenced -------------------------
  hits="$(grep -oE "https?://[A-Za-z0-9._-]*($RETIRED_RE)" "$env" 2>/dev/null | sort -u | tr '\n' ' ')"
  if [ -n "${hits// /}" ]; then
    finding "$app" "env still points at a retired managed host: $hits"
  fi

  # ---- 2. every configured host actually resolves -------------------------
  # A URL that no longer resolves is the shape printcraft was in for weeks
  # while its pages still returned 200.
  while read -r host; do
    [ -z "$host" ] && continue
    case "$host" in localhost|127.0.0.1|0.0.0.0) continue ;; esac
    if ! getent hosts "$host" >/dev/null 2>&1; then
      finding "$app" "configured host does not resolve: $host"
    fi
  done < <(grep -oE '^[A-Z_]+=[^#]*https?://[A-Za-z0-9._-]+' "$env" 2>/dev/null \
           | grep -oE 'https?://[A-Za-z0-9._-]+' | sed 's#https\?://##' | sort -u)

  # ---- 3. the running process vs the file that is supposed to produce it ---
  # Config can be broken on disk for hours while the process still holds the
  # old values in memory. That is a PENDING outage, and a restart detonates it.
  unit="${app}-app.service"
  if systemctl cat "$unit" >/dev/null 2>&1; then
    pid="$(systemctl show "$unit" -p MainPID --value 2>/dev/null)"
    if [ -n "$pid" ] && [ "$pid" != "0" ] && [ -r "/proc/$pid/environ" ]; then
      disk="$(grep -oE '^[A-Z][A-Z0-9_]*=' "$env" | sed 's/=$//' | sort -u)"
      proc="$(tr '\0' '\n' < "/proc/$pid/environ" | grep -oE '^[A-Z][A-Z0-9_]*=' | sed 's/=$//' \
              | grep -vE '^(PATH|HOME|USER|LOGNAME|SHELL|PWD|OLDPWD|LANG|LC_ALL|TERM|SHLVL|_|HOSTNAME|PORT|NODE_ENV|NODE_VERSION|INVOCATION_ID|JOURNAL_STREAM|SYSTEMD_EXEC_PID|MEMORY_PRESSURE_WATCH|MEMORY_PRESSURE_WRITE|NOTIFY_SOCKET|MANAGERPID)$' \
              | sort -u)"
      lost="$(comm -13 <(printf '%s\n' "$disk") <(printf '%s\n' "$proc") | tr '\n' ' ')"
      if [ -n "${lost// /}" ]; then
        finding "$app" "running with keys its .env can no longer provide (lost on next restart): $lost"
      fi
    fi
  fi

  # ---- 4. declared node engine vs the node that will run it ---------------
  for pj in "$dir/app/package.json" "$dir/package.json"; do
    [ -f "$pj" ] || continue
    want="$(grep -oE '"node"[[:space:]]*:[[:space:]]*"[^"]+"' "$pj" 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1)"
    if [ -n "$want" ] && [ -n "$BOX_NODE_MAJOR" ] && [ "$want" -gt "$BOX_NODE_MAJOR" ]; then
      finding "$app" "declares node >=$want but this box runs $BOX_NODE"
    fi
    break
  done
done

# ---- 5. every app unit MEANT to run is running, and still has its guards ----
# Enabled-but-not-active, not merely not-active. aoz-demo is stopped AND
# disabled with nothing routed to its port — deliberately retired, and flagging
# it as a fault is how a check earns the reputation that gets it ignored.
# "Is it supposed to be running?" is a different question from "is it running?".
for u in /etc/systemd/system/*-app.service; do
  [ -e "$u" ] || continue
  unit="$(basename "$u")"; app="${unit%-app.service}"
  enabled="$(systemctl is-enabled "$unit" 2>/dev/null)"
  case "$enabled" in
    enabled|enabled-runtime|static) ;;
    *) continue ;;
  esac
  state="$(systemctl is-active "$unit" 2>/dev/null)"
  # An app that sleeps when idle (lib.sh sleep-when-idle) is inactive BY DESIGN
  # while its wake socket listens: the first request starts it. On 2026-11-02
  # at 03:02 this line sent fifteen "🧩 <app>: unit is enabled but inactive"
  # messages at once — every sleeping app, none of them broken.
  if [ "$state" != "active" ] && systemctl is-active --quiet "${app}-wake.socket" 2>/dev/null; then
    state="active"
  fi
  [ "$state" = "active" ] || finding "$app" "unit is enabled but $state"

  # A rename moves the unit file; it does NOT move the .service.d/ drop-ins
  # beside it. evig-app ran for two days after such a rename with no memory
  # cap on a shared box and no OnFailure, because the drop-ins were still
  # sitting in the OLD unit's directory. Nothing in git describes them — they
  # are box state — so the running system is the only thing that can be asked,
  # and every other app unit here carries both, which is what makes an
  # exception a finding rather than a preference.
  [ "$(systemctl show "$unit" -p MemoryMax --value 2>/dev/null)" = "infinity" ] \
    && finding "$app" "unit has no memory cap (MemoryMax=infinity) on a shared box"
  [ -n "$(systemctl show "$unit" -p OnFailure --value 2>/dev/null)" ] \
    || finding "$app" "unit has no OnFailure= — it can die without alerting anyone"
done

note "checked $(ls -d /opt/*/ 2>/dev/null | wc -l) app dirs on node $BOX_NODE"
note "findings=$findings unreadable=$unreadable"
# Absence of a finding across zero readable apps is not a pass.
if [ "$unreadable" -gt 0 ] && [ "$findings" -eq 0 ]; then
  note "NOTE: $unreadable app(s) could not be read — clean is not proven"
fi
[ "$findings" -eq 0 ]
