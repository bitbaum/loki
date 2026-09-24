#!/usr/bin/env bash
# Threat detection for the box, the GitHub org and the sites — the layer that
# turns "someone got in" from a thing you find out months later into a
# Telegram message within five minutes. Same channel, same transition state and
# the same one-incident-one-message rules as install-host-alerts.sh; nothing
# here adds a daemon, a dashboard or a login to check.
#
# What it wires (all idempotent, all reversible):
#
#   1. /opt/monitoring/security-check.sh — every 5 min. Alerts ONLY on change:
#      firewall or fail2ban or auto-updates down; sshd drifting off keys-only;
#      an edit to any file an intruder would touch (sshd/sudoers/authorized_keys/
#      cron/PAM/ld.so.preload/Caddy/ufw/monitoring scripts/systemd units);
#      a new port open to the internet; a new account, uid-0 or sudoer; an SSH
#      login from an IP never seen before that is not a GitHub Actions runner;
#      a process executing from /tmp, /dev/shm or /var/tmp, or a known miner;
#      a new setuid binary; a new container; the offsite restic snapshot going
#      stale (>30h); a kernel patch waiting on a reboot for more than a week.
#      The first run seeds every baseline silently — nothing to compare to yet.
#   2. /opt/monitoring/github-security-check.sh — daily. New secret-scanning
#      alert, new CRITICAL dependency alert, a repo turning public, a new org
#      member / outside collaborator / deploy key, the Actions allowlist being
#      loosened, secret scanning switched off on a repo that supports it.
#   3. Caddy access logs (JSON, /var/log/caddy/access.log, rolled at 50MB) on
#      every vhost, and a fail2ban jail that bans an IP for 24h after 8 probes
#      for things no user of ours ever asks for (/.env, /.git, wp-login,
#      phpmyadmin, cgi-bin, /etc/passwd …). Response, not a message: the
#      scanner is gone and nobody is told, the ban is in the journal.
#   4. /etc/ssh/sshd_config.d/10-hardening.conf — keys only, 3 tries, no X11,
#      dead-peer detection, AllowUsers root ubuntu.
#
# Rule for every message: sent only if a human must act AND nothing else can,
# and it ends with what to do. A test run sets ALERT_DRY_RUN=1 (journal only).
# Logic is covered by scripts/hetzner/test-security-check.sh (npm run test:ops),
# which extracts the heredoc payloads below and drives them with stubbed tools.
#
# Usage: install-security-watch.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ssh -o BatchMode=yes "$BOX" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
MON=/opt/monitoring
mkdir -p "$MON/state/security"
[ -f "$MON/lib-alert.sh" ] || { echo "lib-alert.sh missing — run install-host-alerts.sh first"; exit 1; }

# ── 4. sshd hardening (first-match-wins, so 10- beats the older 90- drop-in) ─
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'SSHD'
# Managed by loki scripts/hetzner/install-security-watch.sh — edit there.
# Keys only, fewer guesses per connection, no X11, dead-peer detection so a
# hung CI session frees its slot. Root stays prohibit-password because CI
# deploys land on root today.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
X11Forwarding no
MaxAuthTries 3
MaxSessions 20
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 3
AllowUsers root ubuntu
SSHD
if sshd -t 2>/dev/null; then systemctl reload ssh; else
  echo "sshd drop-in rejected by sshd -t — removed, sshd untouched"; rm -f /etc/ssh/sshd_config.d/10-hardening.conf
fi

# ── 1. Box security check ────────────────────────────────────────────────────
cat > "$MON/security-check.sh" <<'SC'
#!/usr/bin/env bash
# Threat detection on the box. Every check compares against a baseline seeded
# on the first run and speaks only on CHANGE, through lib-alert.sh, so a
# condition that persists is one message, not one per tick. Everything also
# goes to the journal (`journalctl -t watchdog`).
#
# Test seams: $MON (state root), $SEC_PREFIX (prefixed onto absolute file
# paths so a test can plant its own /etc), $SEC_PROC (a planted /proc), and every external tool resolved
# via PATH so a test can stub it. Never change a check's behaviour for the
# test's benefit — plant the state the test needs instead.
set -uo pipefail
MON="${MON:-/opt/monitoring}"
. "$MON/lib-alert.sh"
S="$MON/state/security"; mkdir -p "$S"
P="${SEC_PREFIX:-}"
FIRST=0; [ -f "$S/seeded" ] || FIRST=1
NOW=$(date +%s)

# set_diff <baseline-file> <current-list-file> → prints lines in current not in baseline,
# then replaces the baseline. First run: replace silently, print nothing.
set_diff() {
  local base="$1" cur="$2"
  sort -u -o "$cur" "$cur"
  if [ "$FIRST" = 1 ] || [ ! -f "$base" ]; then cp "$cur" "$base"; return 0; fi
  comm -13 "$base" "$cur"
  cp "$cur" "$base"
}
# hourly <key> → true once per hour (state-stamped), so the expensive checks
# (restic over the network, setuid walk) do not run every 5 minutes.
hourly() {
  local f="$S/hourly_$1"
  if [ -f "$f" ] && [ $(( NOW - $(stat -c %Y "$f") )) -lt 3600 ]; then return 1; fi
  touch "$f"; return 0
}

# 1) The guards themselves. If any of these is down, every other check is moot.
if ufw status 2>/dev/null | head -1 | grep -q "Status: active"; then
  alert_transition sec_ufw ok "" ""
else
  alert_transition sec_ufw bad "🧱" "FIREWALL DOWN: ufw is not active — every app port is reachable from the internet. Fix: sudo ufw enable"
fi
for svc in fail2ban unattended-upgrades; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then alert_transition "sec_svc_$svc" ok "" ""
  else alert_transition "sec_svc_$svc" bad "🛡️" "GUARD DOWN: $svc is not running. Fix: sudo systemctl restart $svc"; fi
done

# 2) sshd effective config, as sshd itself resolves it (drop-ins included).
sshd_eff=$(sshd -T 2>/dev/null || true)
drift=""
grep -qi "^passwordauthentication no" <<<"$sshd_eff" || drift="$drift password-auth"
grep -qiE "^permitrootlogin (no|prohibit-password|without-password)" <<<"$sshd_eff" || drift="$drift root-password-login"
grep -qi "^pubkeyauthentication yes" <<<"$sshd_eff" || drift="$drift no-pubkey"
grep -qi "^permitemptypasswords no" <<<"$sshd_eff" || drift="$drift empty-passwords"
if [ -n "$drift" ]; then
  alert_transition sec_sshd bad "🔓" "SSHD DRIFT:${drift} — SSH is no longer keys-only. Fix: sudo sshd -T | grep -i auth, restore /etc/ssh/sshd_config.d/10-hardening.conf"
else
  alert_transition sec_sshd ok "" ""
fi

# 3) Integrity of the files an intruder edits to stay in. One grouped message
#    per tick, so a legitimate batch (a deploy adding units) is one line.
manifest_paths() {
  # shellcheck disable=SC2086
  ls -1d $P/etc/ssh/sshd_config $P/etc/ssh/sshd_config.d/* $P/etc/sudoers $P/etc/sudoers.d/* \
    $P/root/.ssh/authorized_keys $P/home/*/.ssh/authorized_keys $P/etc/shadow \
    $P/etc/crontab $P/etc/cron.d/* $P/etc/cron.hourly/* $P/etc/cron.daily/* $P/var/spool/cron/crontabs/* \
    $P/root/.bashrc $P/root/.profile $P/home/*/.bashrc $P/home/*/.profile \
    $P/etc/ld.so.preload $P/etc/rc.local $P/etc/pam.d/* $P/etc/hosts \
    $P/etc/caddy/Caddyfile $P/etc/caddy/apps.d/* $P/etc/fail2ban/jail.local $P/etc/fail2ban/jail.d/* \
    $P/etc/ufw/user.rules $P/etc/ufw/user6.rules $P/usr/local/bin/* $P/usr/local/sbin/* \
    $P/opt/monitoring/*.sh $P/etc/systemd/system/*.service $P/etc/systemd/system/*.timer \
    $P/etc/apt/sources.list $P/etc/apt/sources.list.d/* 2>/dev/null | sort -u
}
manifest_paths | while read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done > "$S/manifest.paths"
: > "$S/manifest.new"
if [ -s "$S/manifest.paths" ]; then
  # One sha256sum and one stat for the whole list: "hash owner:mode path".
  paste -d' ' <(xargs -d '\n' sha256sum < "$S/manifest.paths" | cut -c1-16) \
              <(xargs -d '\n' stat -c '%U:%a' < "$S/manifest.paths") "$S/manifest.paths" > "$S/manifest.new"
fi
if [ "$FIRST" = 1 ] || [ ! -f "$S/manifest" ]; then
  mv "$S/manifest.new" "$S/manifest"
else
  changed=$(diff <(awk '{print $3}' "$S/manifest" | sort) <(awk '{print $3}' "$S/manifest.new" | sort) \
              | sed -n 's/^< /removed /p; s/^> /added /p')
  edited=$(comm -13 <(sort "$S/manifest") <(sort "$S/manifest.new") | awk '{print $3}' \
             | while read -r f; do grep -q " $f\$" "$S/manifest" && echo "edited $f"; done)
  all=$(printf '%s\n%s\n' "$changed" "$edited" | sed '/^$/d' | sort -u)
  if [ -n "$all" ]; then
    n=$(echo "$all" | wc -l); head5=$(echo "$all" | head -5 | tr '\n' ',' | sed 's/,$//; s/,/, /g')
    more=""; [ "$n" -gt 5 ] && more=" (+$((n-5)) more in journal)"
    logger -t watchdog "sensitive files changed: $(echo "$all" | tr '\n' ';')"
    alert "📝" "$n SENSITIVE FILE(S) CHANGED: ${head5}${more}. If this was you or a deploy, ignore. If not: sudo journalctl -t watchdog, then check who: sudo last -n 20"
  fi
  mv "$S/manifest.new" "$S/manifest"
fi

# 4) Ports open to the internet (non-loopback listeners). ufw still filters
#    them, but a new one is a new process listening where nothing should.
if ss_out=$(ss -tulnpH 2>/dev/null); then
  printf '%s\n' "$ss_out" | awk '$5 !~ /^(127\.|\[::1\]|\[::ffff:127)/ {
    split($5,a,":"); port=a[length(a)]; proc=""; if (match($0,/users:\(\("[^"]+"/)) proc=substr($0,RSTART+9,RLENGTH-10);
    print $1 ":" port " " proc }' | sort -u -k1,1 > "$S/ports.cur"
  newp=$(set_diff "$S/ports" "$S/ports.cur")
else newp=""; logger -t watchdog "security-check: ss failed, port baseline kept"; fi
if [ -n "$newp" ]; then
  alert "🔌" "NEW PORT OPEN TO THE INTERNET: $(echo "$newp" | tr '\n' ',' | sed 's/,$//; s/,/, /g'). ufw blocks it unless a rule allows it. If unexpected: sudo ss -tulnp | grep <port>, then sudo kill it"
fi

# 5) Accounts: anyone with uid 0, a login shell, or sudo/docker group membership.
{
  awk -F: '$3==0 {print "uid0:"$1}' "$P/etc/passwd"
  awk -F: '$7 ~ /sh$/ {print "shell:"$1}' "$P/etc/passwd"
  for g in sudo docker admin wheel; do
    awk -F: -v g="$g" '$1==g && $4!="" {n=split($4,m,","); for(i=1;i<=n;i++) print "group-"g":"m[i]}' "$P/etc/group"
  done
} | sort -u > "$S/accounts.cur"
newa=$(set_diff "$S/accounts" "$S/accounts.cur")
if [ -n "$newa" ]; then
  alert "👤" "NEW PRIVILEGED ACCOUNT: $(echo "$newa" | tr '\n' ' '). If you did not add this: sudo deluser <name> and rotate SSH keys"
fi

# 6) SSH logins from an IP never seen before. Known = every IP that has logged
#    in during the 30 days before the first run + everything seen since; GitHub
#    Actions runner ranges (api.github.com/meta, cached daily) never count as
#    new, because every deploy is one. A password login is impossible here and
#    alerts unconditionally.
touch "$S/ssh-known-ips"
# journalctl's own --cursor-file silently produced nothing when combined with
# --since on this box (measured 2026-09-14: 0 lines, no cursor written, 2030
# lines without it), so the cursor is carried by hand: --show-cursor appends
# "-- cursor: …" after the output, and the next read starts --after-cursor.
ssh_journal() {  # prints Accepted lines, stores the new cursor
  local out
  if [ -s "$S/ssh.cursor" ]; then
    out=$(journalctl -u ssh -o cat --show-cursor --after-cursor="$(cat "$S/ssh.cursor")" 2>/dev/null) \
      || out=$(journalctl -u ssh -o cat --show-cursor --since "10 min ago" 2>/dev/null)
  else
    out=$(journalctl -u ssh -o cat --show-cursor --since "30 days ago" 2>/dev/null)
  fi
  local cur; cur=$(printf '%s\n' "$out" | sed -n 's/^-- cursor: //p' | tail -1)
  [ -n "$cur" ] && printf '%s' "$cur" > "$S/ssh.cursor"
  printf '%s\n' "$out" | grep -oE "Accepted [a-z]+ for [a-z0-9_-]+ from [0-9a-fA-F.:]+" || true
}
if [ ! -f "$S/gh-actions-cidrs" ] || [ $(( NOW - $(stat -c %Y "$S/gh-actions-cidrs") )) -gt 86400 ]; then
  curl -fsS -m 15 https://api.github.com/meta 2>/dev/null | jq -r '.actions[]' > "$S/gh-actions-cidrs.new" 2>/dev/null \
    && [ -s "$S/gh-actions-cidrs.new" ] && mv "$S/gh-actions-cidrs.new" "$S/gh-actions-cidrs"
  rm -f "$S/gh-actions-cidrs.new"
fi
if [ "$FIRST" = 1 ] || [ ! -s "$S/ssh.cursor" ]; then
  ssh_journal | awk '{print $6}' | sort -u >> "$S/ssh-known-ips"
  sort -u -o "$S/ssh-known-ips" "$S/ssh-known-ips"
else
  ssh_journal > "$S/ssh.new"
  if [ -s "$S/ssh.new" ]; then
    grep -E "^Accepted password" "$S/ssh.new" | head -3 | while read -r l; do
      alert "🚨" "SSH PASSWORD LOGIN ACCEPTED (should be impossible): ${l#Accepted password for }. Check sudo sshd -T | grep -i password, then sudo last"
    done
    awk '{print $4 " " $6}' "$S/ssh.new" | sort -u | while read -r user ip; do
      grep -qxF "$ip" "$S/ssh-known-ips" && continue
      if [ -s "$S/gh-actions-cidrs" ] && python3 - "$ip" "$S/gh-actions-cidrs" <<'PY' 2>/dev/null
import ipaddress, sys
ip = ipaddress.ip_address(sys.argv[1])
for line in open(sys.argv[2]):
    line = line.strip()
    if line and ip in ipaddress.ip_network(line, strict=False): sys.exit(0)
sys.exit(1)
PY
      then echo "$ip" >> "$S/ssh-known-ips"; continue; fi
      echo "$ip" >> "$S/ssh-known-ips"
      alert "🔑" "SSH LOGIN as $user from $ip — first time this IP is seen and it is not a GitHub runner. If that was you (new network), ignore. If not: revoke the key in ~/.ssh/authorized_keys on the box and rotate"
    done
  fi
  rm -f "$S/ssh.new"
fi

# 7) Processes that should not exist: anything executing from a temp dir, and
#    the usual miner names.
for p in "${SEC_PROC:-/proc}"/[0-9]*; do
  exe=$(readlink "$p/exe" 2>/dev/null) || continue
  case "$exe" in
    /tmp/*|/dev/shm/*|/var/tmp/*) echo "${p#/proc/} $exe" ;;
  esac
done > "$S/procs.cur"
ps -eo pid=,comm= 2>/dev/null | awk '$2 ~ /^(xmrig|kdevtmpfsi|kinsing|minerd|cryptonight|xmr-stak)$/' >> "$S/procs.cur"
if [ -s "$S/procs.cur" ]; then
  while read -r pid cmd; do
    alert_once "sec_proc_$cmd" 21600 "☠️" "SUSPICIOUS PROCESS: pid $pid running $cmd. Kill it: sudo kill -9 $pid; then find how it got there: sudo journalctl -t watchdog, sudo last"
  done < "$S/procs.cur"
fi

# 8) Hourly: new setuid binaries on the system paths (a classic persistence
#    trick), and the offsite backup's age. A backup that silently stopped is
#    the difference between an incident and a loss.
if hourly setuid; then
  find $P/usr/bin $P/usr/sbin $P/usr/local/bin $P/usr/local/sbin $P/bin $P/sbin $P/opt -xdev -perm -4000 -type f 2>/dev/null | sort -u > "$S/setuid.cur"
  news=$(set_diff "$S/setuid" "$S/setuid.cur")
  [ -n "$news" ] && alert "🧨" "NEW SETUID BINARY: $(echo "$news" | tr '\n' ' '). If no package upgrade explains it: sudo chmod u-s <file> and investigate"
fi
if hourly restic && [ -f "$P/opt/backups/restic.env" ]; then
  set -a; . "$P/opt/backups/restic.env"; set +a
  latest=$(restic snapshots --latest 1 --json 2>/dev/null | jq -r 'map(.time) | max // empty' | cut -c1-19)
  if [ -n "$latest" ]; then
    age=$(( (NOW - $(date -d "$latest" +%s 2>/dev/null || echo "$NOW")) / 3600 ))
    if [ "$age" -gt 30 ]; then
      alert_transition sec_backup bad "🗄️" "OFFSITE BACKUP STALE: last restic snapshot ${age}h ago ($latest). Check: sudo journalctl -u pg-backup -n 30"
    else alert_transition sec_backup ok "" ""; fi
  else
    alert_transition sec_backup bad "🗄️" "OFFSITE BACKUP UNREACHABLE: restic cannot list snapshots. Check: sudo journalctl -u pg-backup -n 30"
  fi
fi

# 9) Containers: a new one is a new thing serving or talking on this box.
if dk=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null); then
  printf '%s\n' "$dk" | sed '/^$/d' | sort -u > "$S/containers.cur"
  newc=$(set_diff "$S/containers" "$S/containers.cur")
else newc=""; logger -t watchdog "security-check: docker ps failed, container baseline kept"; fi
[ -n "$newc" ] && alert "🐳" "NEW CONTAINER: $(echo "$newc" | tr '\n' ',' | sed 's/,$//; s/,/, /g'). If not from a deploy: docker stop <name>"

# 10) A kernel patch that needs a reboot, once a week at most.
if [ -f "$P/var/run/reboot-required" ]; then
  since=$(stat -c %Y "$P/var/run/reboot-required")
  if [ $(( NOW - since )) -gt 604800 ]; then
    alert_once sec_reboot 604800 "♻️" "REBOOT PENDING for $(( (NOW - since) / 86400 )) days (kernel/security patch not live until then). When convenient: sudo reboot — apps come back on their own"
  fi
fi

touch "$S/seeded"
exit 0
SC
chmod +x "$MON/security-check.sh"

cat > /etc/systemd/system/security-check.service <<'SVC'
[Unit]
Description=Box threat detection (firewall/sshd/integrity/ports/accounts/logins/procs/backup)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/monitoring/security-check.sh
SVC
cat > /etc/systemd/system/security-check.timer <<'TIMER'
[Unit]
Description=Run security-check every 5 min
[Timer]
OnBootSec=4min
OnUnitActiveSec=5min
Persistent=true
Unit=security-check.service
[Install]
WantedBy=timers.target
TIMER

# ── 2. GitHub org check ──────────────────────────────────────────────────────
cat > "$MON/github-security-check.sh" <<'GHC'
#!/usr/bin/env bash
# Daily look at the GitHub org through the box's own gh login. Speaks only on
# something NEW (ids kept in state), through lib-alert.sh. Test seams: $MON,
# $GH_ORG, and `gh` resolved via PATH.
#
# Every API call is guarded: a call that fails SKIPS its check for today and
# leaves the baseline alone. Two reasons, both measured 2026-09-14. (1) The
# first version read an error body as a value and paged "ACTIONS POLICY
# LOOSENED: allowed_actions={"message":"You must be an org admin…"}" — a
# message about nothing, to a real phone. (2) A transient failure that wiped a
# baseline would make the next good read report every repo, member and key as
# new. A check the token cannot make is noted in the journal, once a day.
set -uo pipefail
MON="${MON:-/opt/monitoring}"
. "$MON/lib-alert.sh"
S="$MON/state/security"; mkdir -p "$S"
ORG="${GH_ORG:-bitbaum}"
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-/home/ubuntu/.config/gh}"
FIRST=0; [ -f "$S/gh-seeded" ] || FIRST=1
set_diff() {
  local base="$1" cur="$2"; sort -u -o "$cur" "$cur"
  if [ "$FIRST" = 1 ] || [ ! -f "$base" ]; then cp "$cur" "$base"; return 0; fi
  comm -13 "$base" "$cur"; cp "$cur" "$base"
}
# ghq <name> <endpoint> <jq> → writes $S/gh-<name>.cur and returns 0, or logs and returns 1
ghq() {
  local name="$1" ep="$2" jq="$3" out
  if out=$(gh api --paginate "$ep" --jq "$jq" 2>/dev/null); then
    printf '%s\n' "$out" | sed '/^$/d' > "$S/gh-$name.cur"; return 0
  fi
  logger -t watchdog "github-security-check: $name skipped — gh api $ep failed (token scope? outage?)"
  return 1
}
if ! gh api "orgs/$ORG" --jq .login >/dev/null 2>&1; then
  alert_transition sec_gh bad "🐙" "GITHUB CHECK BLIND: the box's gh login cannot read org $ORG (token expired?). Fix on the box: gh auth login"
  exit 0
fi
alert_transition sec_gh ok "" ""

# Secrets pushed into a repo — GitHub found one; you need to rotate it. Read
# PER REPO: on 2026-09-14 the org-level endpoint answered [] while botsmann's
# own endpoint listed three open alerts, so the org view would have stayed
# silent forever. A repo whose alerts cannot be read (scanning unavailable on
# the plan, no access) is noted in the journal and skipped, not treated as empty.
#
# ONE MESSAGE PER REPO, never per alert, and forks are skipped: on 2026-09-14
# the first per-repo version found ~100 open alerts in the openclaw FORK
# (upstream's own test fixtures) and sent 100 Telegram messages in one run —
# the exact storm this channel exists to prevent. A fork's alerts are the
# upstream's problem; a repo of ours with N new alerts is one line naming N.
if ghq repolist "orgs/$ORG/repos?per_page=100" '.[] | select(.archived==false and ((.fork // false) == false)) | .name'; then
  : > "$S/gh-secrets.cur"
  while read -r r; do
    if out=$(gh api "repos/$ORG/$r/secret-scanning/alerts?state=open&per_page=100" \
               --jq ".[] | \"$r#\(.number)|\(.secret_type_display_name)\"" 2>/dev/null); then
      printf '%s\n' "$out" | sed '/^$/d' >> "$S/gh-secrets.cur"
    else logger -t watchdog "github-security-check: secret alerts for $r unreadable (scanning off or no access)"; fi
  done < "$S/gh-repolist.cur"
  set_diff "$S/gh-secrets" "$S/gh-secrets.cur" > "$S/gh-secrets.new"
  if [ -s "$S/gh-secrets.new" ]; then
    cut -d'#' -f1 "$S/gh-secrets.new" | sort -u | while read -r r; do
      n=$(grep -c "^$r#" "$S/gh-secrets.new")
      types=$(grep "^$r#" "$S/gh-secrets.new" | cut -d'|' -f2 | sort | uniq -c | sort -rn | head -3 | awk '{c=$1; $1=""; sub(/^ /,""); printf "%s×%s, ", $0, c}' | sed 's/, $//')
      alert "🕵️" "$n SECRET(S) IN REPO $r: $types. Rotate at the provider, then resolve: https://github.com/$ORG/$r/security/secret-scanning"
    done
  fi
  rm -f "$S/gh-secrets.new"
fi

# Critical dependency alerts on deployed code. High/medium stay in Dependabot;
# critical is the one worth a line.
if ghq deps "orgs/$ORG/dependabot/alerts?state=open&severity=critical&per_page=100" \
     '.[] | "\(.repository.name)#\(.number)|\(.dependency.package.name)"'; then
  newd=$(set_diff "$S/gh-deps" "$S/gh-deps.cur")
  if [ -n "$newd" ]; then
    n=$(echo "$newd" | wc -l)
    alert "🛡️" "$n NEW CRITICAL DEPENDENCY ALERT(S): $(echo "$newd" | sed 's/#[0-9]*|/:/' | head -6 | tr '\n' ' '). Bump and deploy: https://github.com/orgs/$ORG/security/alerts/dependabot?query=severity%3Acritical"
  fi
fi

# Repos: one turning public, or secret scanning switched off where it is available.
if ghq repos "orgs/$ORG/repos?per_page=100" \
     '.[] | "\(.name)|\(if .private then "private" else "PUBLIC" end)|\(.archived)|\(.security_and_analysis.secret_scanning.status)"'; then
  awk -F'|' '$2=="PUBLIC"{print $1}' "$S/gh-repos.cur" > "$S/gh-public.cur"
  newpub=$(set_diff "$S/gh-public" "$S/gh-public.cur")
  [ -n "$newpub" ] && alert "🌍" "REPO NOW PUBLIC: $(echo "$newpub" | tr '\n' ' '). If unintended: gh repo edit $ORG/<name> --visibility private"
  awk -F'|' '$3=="false" && $4=="disabled"{print $1}' "$S/gh-repos.cur" > "$S/gh-noscan.cur"
  newns=$(set_diff "$S/gh-noscan" "$S/gh-noscan.cur")
  [ -n "$newns" ] && alert "🔍" "SECRET SCANNING OFF: $(echo "$newns" | tr '\n' ' '). Re-enable: gh api -X PATCH repos/$ORG/<name> -f security_and_analysis[secret_scanning][status]=enabled"

  # Deploy keys, per active repo; one failed repo skips the whole check today.
  keys_ok=1; : > "$S/gh-deploykeys.cur"
  while read -r r; do
    if out=$(gh api "repos/$ORG/$r/keys" --jq ".[] | \"$r:\(.id):\(.title)\"" 2>/dev/null); then printf '%s\n' "$out" | sed '/^$/d' >> "$S/gh-deploykeys.cur"
    else keys_ok=0; logger -t watchdog "github-security-check: deploy keys skipped — repos/$ORG/$r/keys failed"; break; fi
  done < <(awk -F'|' '$3=="false"{print $1}' "$S/gh-repos.cur")
  if [ "$keys_ok" = 1 ]; then
    newk=$(set_diff "$S/gh-deploykeys" "$S/gh-deploykeys.cur")
    [ -n "$newk" ] && alert "🗝️" "NEW DEPLOY KEY: $(echo "$newk" | tr '\n' ' '). If not yours: https://github.com/$ORG/<repo>/settings/keys"
  fi
fi

# People and apps with access.
if ghq members "orgs/$ORG/members?per_page=100" '.[] | "member:\(.login)"' \
   && ghq collabs "orgs/$ORG/outside_collaborators?per_page=100" '.[] | "collaborator:\(.login)"' \
   && ghq apps "orgs/$ORG/installations" '.installations[] | "app:\(.app_slug)"'; then
  cat "$S/gh-members.cur" "$S/gh-collabs.cur" "$S/gh-apps.cur" > "$S/gh-people.cur"
  newpp=$(set_diff "$S/gh-people" "$S/gh-people.cur")
  [ -n "$newpp" ] && alert "🧑‍💻" "NEW ACCESS TO THE ORG: $(echo "$newpp" | tr '\n' ' '). If you did not grant it: https://github.com/orgs/$ORG/people"
fi

# The Actions allowlist being loosened lets any marketplace action run with
# the org's secrets, including the SSH key to this box. Needs admin:org on the
# token; without it the check is skipped (journal), never guessed.
if pol=$(gh api "orgs/$ORG/actions/permissions" --jq .allowed_actions 2>/dev/null) && [ -n "$pol" ]; then
  if [ "$pol" = "selected" ]; then alert_transition sec_gh_actions ok "" ""
  else alert_transition sec_gh_actions bad "🎬" "ACTIONS POLICY LOOSENED: allowed_actions=$pol (was: selected allowlist). Restore: https://github.com/organizations/$ORG/settings/actions"; fi
else
  logger -t watchdog "github-security-check: actions policy skipped — token lacks admin:org (gh auth refresh -s admin:org on the box to enable)"
fi

touch "$S/gh-seeded"
exit 0
GHC
chmod +x "$MON/github-security-check.sh"

cat > /etc/systemd/system/github-security-check.service <<'SVC'
[Unit]
Description=GitHub org threat detection (secrets/critical deps/visibility/access/policy)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/monitoring/github-security-check.sh
SVC
cat > /etc/systemd/system/github-security-check.timer <<'TIMER'
[Unit]
Description=Run github-security-check daily
[Timer]
OnCalendar=*-*-* 07:10:00
RandomizedDelaySec=10min
Persistent=true
Unit=github-security-check.service
[Install]
WantedBy=timers.target
TIMER

# ── 3. Caddy access logs + fail2ban scanner jail ─────────────────────────────
# Dir AND file exist and belong to caddy BEFORE the reload: the first install
# reloaded with only the dir in place and Caddy refused the config with
# "open /var/log/caddy/access.log: permission denied" (the old config kept
# serving, so nothing was down — but the log stayed off).
install -d -o caddy -g caddy -m 750 /var/log/caddy
chown caddy:caddy /var/log/caddy
[ -f /var/log/caddy/access.log ] || install -o caddy -g caddy -m 640 /dev/null /var/log/caddy/access.log
chown caddy:caddy /var/log/caddy/access.log
CF=/etc/caddy/Caddyfile
cp -a "$CF" "$CF.bak-security-$(date +%Y%m%d-%H%M%S)"
if ! grep -q '^(access_log)' "$CF"; then
  # Snippet defined right after the global options block, before any import.
  awk 'BEGIN{done=0} {print} !done && /^}$/ {print ""; print "# Access log on every vhost (import access_log) — read by fail2ban caddy-scan."; print "# Managed by loki scripts/hetzner/install-security-watch.sh."; print "(access_log) {"; print "\tlog {"; print "\t\toutput file /var/log/caddy/access.log {"; print "\t\t\troll_size 50mb"; print "\t\t\troll_keep 3"; print "\t\t}"; print "\t\tformat json {"; print "\t\t\ttime_format iso8601"; print "\t\t}"; print "\t}"; print "}"; done=1}' "$CF" > "$CF.new" && mv "$CF.new" "$CF"
fi
# Every site block header (`host, host {`) that is not the global block or the
# snippet gets `import access_log` as its first line, once.
add_import() {
  local f="$1"
  awk '
    { print }
    /^[A-Za-z0-9*][A-Za-z0-9.,:* -]*\{$/ && $0 !~ /^\(/ {
      if ((getline nxt) > 0) {
        if (nxt !~ /import access_log/) print "\timport access_log"
        print nxt
      } else print "\timport access_log"
    }' "$f" > "$f.new" && mv "$f.new" "$f"
}
add_import "$CF"
for f in /etc/caddy/apps.d/*.caddy; do [ -f "$f" ] && add_import "$f"; done
if caddy validate --config "$CF" >/dev/null 2>&1; then
  systemctl reload caddy && echo "[security] caddy access logs on"
else
  echo "[security] Caddyfile invalid after edit — restoring"; latest=$(ls -t "$CF".bak-security-* | head -1); cp -a "$latest" "$CF"
  for f in /etc/caddy/apps.d/*.caddy; do sed -i '/^\timport access_log$/d' "$f"; done
fi

cat > /etc/fail2ban/filter.d/caddy-scan.conf <<'F2B_FILTER'
# Requests no user of ours ever makes: probes for dotfiles, PHP admin panels,
# path traversal, framework debug consoles. Eight in ten minutes = a scanner.
# Managed by loki scripts/hetzner/install-security-watch.sh.
[Definition]
failregex = ^.*"client_ip":"<HOST>".*"uri":"[^"]*(?:/\.env|/\.git|/\.aws|/\.ssh|/\.DS_Store|wp-login|wp-admin|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|/cgi-bin/|\.php(?:\?|"|/)|/etc/passwd|\.\./|/actuator|/_ignition|/solr/|/manager/html|/console/|/vendor/phpunit|/telescope|/\.vscode|/\.idea|/server-status|/id_rsa|/backup\.(?:zip|sql|tar))[^"]*".*"status":(?:40[0134]|5\d\d)
ignoreregex =
datepattern = ^.*"ts":"{DATE}"
F2B_FILTER
cat > /etc/fail2ban/jail.d/caddy-scan.conf <<'F2B_JAIL'
# Managed by loki scripts/hetzner/install-security-watch.sh.
[caddy-scan]
enabled  = true
port     = http,https
logpath  = /var/log/caddy/access.log
backend  = auto
maxretry = 8
findtime = 10m
bantime  = 24h
F2B_JAIL
fail2ban-client reload >/dev/null 2>&1 || systemctl restart fail2ban
sleep 1; fail2ban-client status caddy-scan >/dev/null 2>&1 && echo "[security] fail2ban caddy-scan jail active" || echo "[security] WARNING: caddy-scan jail not active"

# ── Enable, seed, first run ──────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now security-check.timer github-security-check.timer >/dev/null 2>&1 || true
# The first tick after an install absorbs this script's own edits (the checks,
# the jail, the drop-in) into the baseline journal-only: an install is not an
# intrusion, and the second install of the day paged "2 SENSITIVE FILE(S)
# CHANGED: security-check.sh, github-security-check.sh" about itself.
ALERT_DRY_RUN=1 /opt/monitoring/security-check.sh >/dev/null 2>&1 || true
# Same for the GitHub check: when its data source changes (org endpoint →
# per-repo, 2026-09-14) everything it now sees is "new", and the live run
# after that install sent 100 messages. The timer's next run is live.
ALERT_DRY_RUN=1 /opt/monitoring/github-security-check.sh >/dev/null 2>&1 || true
echo "[security] security-check.timer + github-security-check.timer active; baselines seeded: $(ls /opt/monitoring/state/security | wc -l) state files"
REMOTE
