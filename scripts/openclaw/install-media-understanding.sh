#!/usr/bin/env bash
# Teach the chat agent to SEE: screenshots, photos and videos sent on Telegram.
#
# WHY THIS EXISTS. The Telegram agent is OpenClaw on bitbaum, and OpenClaw
# already has inbound media understanding — an attachment is described by a
# vision model before the chat model reads the turn. But it ran on defaults,
# and the defaults are wrong for how George uses it:
#
#   - every description is cut at 500 characters. A screenshot of a chat, an
#     error or a settings page loses most of its text, so "look at this and do
#     something" became "look at a summary of this and guess";
#   - one attachment per message, so a Telegram album of screenshots was read
#     as its first picture;
#   - video is only described if some video-capable key happens to be found,
#     with a 500-char, "Describe the video." prompt — nothing to argue with
#     when he asks whether a clip is nonsense.
#
# The block lives in this repo (media-understanding.json) so it is versioned
# and reviewable, and this script is the only way it reaches the box — the same
# rule as install-loki-skill.sh, for the same reason: config that exists only
# on the box drifts without anyone seeing it.
#
# ONLY image and video are written. `tools.media.audio` is left exactly as it
# is: voice notes already transcribe, and overwriting a working STT chain to
# make this file tidier would trade a feature for symmetry.
#
# Model: Gemini (provider `google`, its default model — so an OpenClaw upgrade
# moves it forward without an edit here). It is the provider OpenClaw ranks
# first for video, and it hears the audio track, so a video's speech arrives
# as a transcript alongside what is on screen. Needs GEMINI_API_KEY (or
# GOOGLE_API_KEY) where the gateway reads env: ~/.openclaw/.env or
# ~/.config/openclaw/gateway.env for the openclaw user. A free key is at
# https://aistudio.google.com/apikey.
#
# LIMIT THIS DOES NOT LIFT: Telegram's cloud Bot API will not hand a bot a file
# over 20 MB, so longer videos arrive as "file is too big". Lifting it means a
# self-hosted Bot API server (channels.telegram.apiRoot) — a separate change.
#
# Usage: bash scripts/openclaw/install-media-understanding.sh [user@host]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

HOST="${1:-ubuntu@167.233.22.31}"
SRC="scripts/openclaw/media-understanding.json"
STAGE="/tmp/openclaw-media-$$"

[ -f "$SRC" ] || { echo "✗ $SRC missing"; exit 1; }
IMAGE_JSON=$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).image))' "$PWD/$SRC")
VIDEO_JSON=$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).video))' "$PWD/$SRC")

# Every remote step runs as the openclaw user: that is the user whose
# ~/.openclaw the gateway reads. The runtime dir is set so `gateway restart`
# can reach the user's systemd.
#
# The CLI is NOT on that user's login-shell PATH — the first run from GitHub
# Actions (2026-09-29) died on `openclaw: command not found` after the key
# check had passed. It is installed under nvm, which only an interactive
# .bashrc puts on PATH. So each step first sources .bashrc (tolerating its
# early return for non-interactive shells), then falls back to the places a
# global npm install lands, and refuses loudly if none has the binary.
OC_FIND_CLI='[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc" >/dev/null 2>&1 || true
command -v openclaw >/dev/null 2>&1 || for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.npm-global/bin "$HOME"/.local/bin /usr/local/bin; do
  [ -x "$d/openclaw" ] && PATH="$d:$PATH" && break
done
command -v openclaw >/dev/null 2>&1 || { echo "✗ no openclaw CLI on PATH for the openclaw user (looked in nvm, ~/.npm-global, ~/.local/bin, /usr/local/bin)" >&2; exit 127; }'
# The script travels on STDIN, not as an argument. `sudo -i` re-joins and
# re-parses its argument string through the target user's shell, so a
# multi-line command with quotes and braces arrives broken (the second run
# from GitHub Actions died on "unexpected end of file from `{'"). A script
# read by `bash -s` is never re-parsed by anything in between.
as_openclaw() {
  printf '%s\n%s\n' "$OC_FIND_CLI" "$1" \
    | ssh "$HOST" "sudo -iu openclaw env XDG_RUNTIME_DIR=/run/user/\$(id -u openclaw) bash -ls"
}

echo "→ checking the gateway can reach Gemini"
# Checked BEFORE writing anything. Without a key the config is accepted, the
# gateway restarts cleanly, and every picture is silently not described — the
# failure this file exists to end. So no key means no install.
if ! as_openclaw 'grep -qsE "^(export )?(GEMINI_API_KEY|GOOGLE_API_KEY)=.+" ~/.openclaw/.env ~/.config/openclaw/gateway.env'; then
  echo "✗ no GEMINI_API_KEY / GOOGLE_API_KEY for the openclaw user on $HOST."
  echo "  Add one line to /home/openclaw/.openclaw/.env:"
  echo "    GEMINI_API_KEY=<key from https://aistudio.google.com/apikey>"
  echo "  then re-run this script."
  exit 1
fi
echo "  a Google key is configured"

echo "→ writing tools.media.image and tools.media.video"
# `config set` backs the file up, validates against the installed OpenClaw's
# own schema and refuses a bad value — so a key this version does not know
# fails here, not at the next gateway start.
as_openclaw "openclaw config set tools.media.image $(printf '%q' "$IMAGE_JSON") --strict-json --merge"
as_openclaw "openclaw config set tools.media.video $(printf '%q' "$VIDEO_JSON") --strict-json --merge"
as_openclaw "openclaw config validate" \
  || { echo "✗ openclaw.json no longer validates — restore it from openclaw.json.bak before the gateway restarts"; exit 1; }

echo "→ restarting the gateway"
# Not `openclaw gateway restart`. Under `sudo -iu openclaw` the CLI reaches
# for `systemctl --machine openclaw@ --user`, which needs the openclaw user's
# own systemd manager to be running — and on the box it is not (the third run
# from GitHub Actions: "Failed to connect to user scope bus via machine
# transport: Connection refused"). So the restart is done as root, by finding
# what actually supervises the gateway, in the order a hardened co-located
# install is likely to use. Every branch says what it did; the failure branch
# prints what it found, so the next attempt starts from facts, not guesses.
#
# The unit is matched by what it RUNS, not by a name prefix: the fourth run
# restarted `ivy-health-deep.service`, a health probe that merely shares the
# `ivy` prefix, and then waited on a port nothing was listening to. So this
# prints what it finds — units, the gateway process, its listening sockets —
# before touching anything, and the health check below trusts the socket
# list over an assumed port.
ssh "$HOST" bash -s <<'SH'
set -u
echo "  units mentioning openclaw/ivy: $(grep -lsE 'openclaw|ivy' /etc/systemd/system/*.service /lib/systemd/system/*.service 2>/dev/null | xargs -rn1 basename | tr '\n' ' ')"
echo "  gateway process: $(pgrep -u openclaw -af 'gateway' 2>/dev/null | head -3 | tr '\n' ';' || echo none)"
echo "  listening (openclaw's node): $(ss -ltnp 2>/dev/null | grep -E 'users:\(\("(node|openclaw)' | awk '{print $4}' | tr '\n' ' ')"
unit=""
for f in /etc/systemd/system/*.service /lib/systemd/system/*.service; do
  [ -f "$f" ] || continue
  grep -qE 'openclaw|ivy' "$f" 2>/dev/null && grep -qi 'gateway' "$f" && { unit=$(basename "$f"); break; }
done
[ -n "$unit" ] || unit=$(systemctl list-units --all --type=service --no-legend --plain 2>/dev/null \
  | awk '{print $1}' | grep -iE '^(openclaw|ivy).*gateway' | head -1)
if [ -n "$unit" ]; then
  systemctl restart "$unit" && echo "  restarted system unit $unit" && exit 0
fi
uid=$(id -u openclaw)
if [ -S "/run/user/$uid/bus" ]; then
  systemctl --machine openclaw@ --user restart openclaw-gateway \
    && echo "  restarted user unit openclaw-gateway" && exit 0
fi
uunit=$(ls /home/openclaw/.config/systemd/user/*.service 2>/dev/null | head -1)
if [ -n "$uunit" ]; then
  # A user unit exists but its manager is not running: the install forgot
  # `loginctl enable-linger`, which is also why the gateway would not survive
  # a reboot. Enabling it is the fix the CLI's own installer intends.
  loginctl enable-linger openclaw && sleep 3 \
    && systemctl --machine openclaw@ --user restart "$(basename "$uunit")" \
    && echo "  enabled linger and restarted user unit $(basename "$uunit")" && exit 0
fi
echo "✗ could not find how the gateway is supervised. What is there:" >&2
systemctl list-units --all --type=service --no-legend --plain 2>/dev/null | grep -iE 'claw|ivy|gateway' | sed 's/^/    unit: /' >&2 \
  || echo "    no systemd unit named like openclaw / ivy / gateway" >&2
ls /home/openclaw/.config/systemd/user/ 2>/dev/null | sed 's/^/    user unit file: /' >&2
pgrep -u openclaw -af 'openclaw|gateway' 2>/dev/null | sed 's/^/    process: /' >&2 \
  || echo "    no openclaw process running as the openclaw user" >&2
exit 1
SH

# Up means the gateway process is back and listening — the one fact every
# supervisor shape shares — not a systemd status the CLI may be unable to
# read. Answering HTTP on the default :18789 is the strongest signal; a
# gateway process with any listening socket is accepted too, since the box
# may bind another port, and the socket list is printed so the next reader
# knows which.
for i in $(seq 1 15); do
  code=$(ssh "$HOST" "curl -s -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:18789/" 2>/dev/null || true)
  case "$code" in [1-5][0-9][0-9]) echo "  gateway is up (HTTP $code on :18789)"; break ;; esac
  socks=$(ssh "$HOST" 'p=$(pgrep -u openclaw -f gateway 2>/dev/null | head -1); [ -n "$p" ] && ss -ltnp 2>/dev/null | grep "pid=$p," | awk "{print \$4}" | tr "\n" " "' 2>/dev/null || true)
  if [ -n "${socks// /}" ]; then echo "  gateway is up (process listening on $socks — not :18789)"; break; fi
  [ "$i" -eq 15 ] && { echo "✗ the gateway did not come back within 45s: nothing on :18789 and no listening gateway process"; exit 1; }
  sleep 3
done

echo "→ proving it sees"
# The check that matters: run the real describe path as the real user and
# require an answer about a picture whose content we know. A config that is
# present but never answers is exactly the state this replaces.
ssh "$HOST" "rm -rf $STAGE && mkdir -p $STAGE && chmod 755 $STAGE"
ssh "$HOST" "python3 - $STAGE/red.png" <<'PY'
import struct, sys, zlib
w = h = 64
raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) \
    + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
PY
image_out=$(as_openclaw "openclaw infer image describe --file $STAGE/red.png" 2>&1 || true)
if grep -qi "red" <<<"$image_out"; then
  echo "  image: described a red test square as red"
else
  ssh "$HOST" "rm -rf $STAGE"
  echo "✗ image understanding did not answer. Output:"
  printf '%s\n' "$image_out" | tail -5 | sed 's/^/    /'
  exit 1
fi

# Video needs ffmpeg on the box only to MAKE the test clip. Without it the
# video path is configured but unproven — said out loud, never passed quietly.
if ssh "$HOST" "command -v ffmpeg >/dev/null"; then
  ssh "$HOST" "ffmpeg -loglevel error -f lavfi -i color=c=blue:s=160x120:d=2 -pix_fmt yuv420p $STAGE/blue.mp4 && chmod 644 $STAGE/blue.mp4"
  video_out=$(as_openclaw "openclaw infer video describe --file $STAGE/blue.mp4" 2>&1 || true)
  if grep -qi "blue" <<<"$video_out"; then
    echo "  video: described a blue test clip as blue"
  else
    ssh "$HOST" "rm -rf $STAGE"
    echo "✗ video understanding did not answer. Output:"
    printf '%s\n' "$video_out" | tail -5 | sed 's/^/    /'
    exit 1
  fi
else
  echo "  ⚠ video: configured but NOT proven — no ffmpeg on $HOST to make a test clip."
  echo "    Send the bot a short video and check it describes it."
fi
ssh "$HOST" "rm -rf $STAGE"

echo "✓ the Telegram agent now reads screenshots, photos and videos (≤20 MB) on $HOST"
