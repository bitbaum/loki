#!/usr/bin/env bash
#
# A prospect preview that is actually reachable: its address answers over HTTPS.
#
#   ensure-preview.sh create  <address> <name> [about] [code]         make it, give it its host, prove it
#   ensure-preview.sh website <url> [changes] [fixes] [answers] [code] /change "Improve this site", as the operator
#   ensure-preview.sh check   <address>                               open a preview as its owner: site, tour, pictures
#   ensure-preview.sh heal                                            every preview has its host, and answers
#
# Wildcard DNS sends every <label>.orangecat.ch to the box, but a label with no
# Caddy vhost gets no certificate, so the browser shows ERR_SSL_PROTOCOL_ERROR
# instead of anything useful. That was found by a person, on a phone, four
# times. So this is not "attach and hope": it attaches (idempotent), and then
# asks the host over HTTPS until it answers, and fails loudly if it does not.
# `heal` is the same check for every preview folder on the box, on a clock, so a
# lost vhost is put back before anyone opens the link.
#
# What counts as answering: any HTTP status. A preview with no access code yet
# answers 503 ("switched off"), with one 401 (the gate), and both mean the
# address and its certificate work. 000 is the failure (no TLS); 404 on a
# created preview means Loki has no such preview.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/lib.sh"

MODE="${1:-}"
BASE="$SITES_BASE_DOMAIN"

ssh_box() {
  if [ -r "${DEPLOY_KEY_PATH:-}" ]; then
    ssh -o BatchMode=yes -o ConnectTimeout=20 -i "$DEPLOY_KEY_PATH" "$BOX" "$@"
  else
    ssh -o BatchMode=yes -o ConnectTimeout=20 "$BOX" "$@"
  fi
}

# answers <host> — wait up to ~100s (a new certificate takes a few seconds).
answers() {
  local host="$1" code="000" i
  for i in $(seq 1 20); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$host/" 2>/dev/null || true)
    [ "$code" != "000" ] && break
    sleep 5
  done
  echo "$code"
}

fail=0
note() { echo "  $*"; }
bad()  { echo "::error::$*"; fail=1; }

case "$MODE" in
create)
  ADDRESS="${2:?address}"; NAME="${3:?name}"; ABOUT="${4:-}"; CODE="${5:-}"
  echo "→ host $ADDRESS.$BASE"
  bash "$HERE/attach-preview-host.sh" "$ADDRESS" || bad "could not attach $ADDRESS.$BASE"
  echo "→ the preview in Loki"
  ssh_box "bash -s -- $(printf '%q ' name "$ADDRESS" "$NAME" "$ABOUT" "$CODE")" < "$HERE/preview-create-on-box.sh" \
    || bad "Loki did not create the preview (see the lines above)"
  code=$(answers "$ADDRESS.$BASE")
  note "https://$ADDRESS.$BASE/ → HTTP $code"
  case "$code" in
    000) bad "$ADDRESS.$BASE does not answer over HTTPS" ;;
    404) bad "$ADDRESS.$BASE answers but Loki has no preview called $ADDRESS" ;;
  esac
  ;;
website)
  # The whole /change path on the deployed app: consultation, brief, folder,
  # host, build. The app attaches the host itself; the answer names the
  # address, which is then asked over HTTPS like any other preview.
  WEBSITE="${2:?url}"; CHANGES="${3:-}"; FIXES="${4:-}"; ANSWERS="${5:-}"; CODE="${6:-}"
  echo "→ the new version of $WEBSITE, in Loki"
  reply=$(ssh_box "bash -s -- $(printf '%q ' website "$WEBSITE" "$CHANGES" "$FIXES" "$ANSWERS" "$CODE")" < "$HERE/preview-create-on-box.sh") \
    || bad "Loki did not start the preview (see the lines above)"
  echo "$reply"
  host=$(printf '%s' "$reply" | grep -oE '"previewUrl": ?"https://[^/"]+' | head -1 | sed -E 's#.*https://##')
  if [ -n "$host" ]; then
    code=$(answers "$host")
    note "https://$host/ → HTTP $code"
    [ "$code" != "000" ] || bad "$host does not answer over HTTPS"
    echo "→ as the owner (the build has only just started; the tour fills in as it goes)"
    ssh_box "bash -s -- $(printf '%q' "$host")" < "$HERE/preview-check-on-box.sh" || note "the owner's view is not open yet"
  else
    note "no address in the answer (a resumed request, or a server without previews)"
  fi
  ;;
check)
  LABEL="${2:?address}"
  host="$LABEL.$BASE"
  echo "→ $host as the owner"
  ssh_box "bash -s -- $(printf '%q' "$host")" < "$HERE/preview-check-on-box.sh" || bad "$host: the site or its tour did not open"
  ;;
heal)
  root=$(ssh_box 'set -a; . /opt/loki/app/.env; set +a; r="${LOKI_PREVIEWS_ROOT:-}"; [ -n "$r" ] || { [ -n "${LOKI_BOX_DEV_ROOT:-}" ] && r="${LOKI_BOX_DEV_ROOT%/}/previews"; }; printf %s "$r"')
  [ -n "$root" ] || { echo "no previews root configured on the box; nothing to heal"; exit 0; }
  labels=$(ssh_box "ls -1 '$root' 2>/dev/null" | grep -E '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$' || true)
  [ -n "$labels" ] || { echo "no previews yet"; exit 0; }
  for label in $labels; do
    bash "$HERE/attach-preview-host.sh" "$label" >/dev/null 2>&1 || { bad "could not attach $label.$BASE"; continue; }
    code=$(answers "$label.$BASE")
    note "$label.$BASE → HTTP $code"
    [ "$code" != "000" ] || bad "$label.$BASE does not answer over HTTPS"
  done
  ;;
*)
  echo "usage: ensure-preview.sh create <address> <name> [about] [code] | website <url> [changes] [fixes] [answers] [code] | check <address> | heal" >&2; exit 2 ;;
esac

[ "$fail" = 0 ] && echo "OK" || exit 1
