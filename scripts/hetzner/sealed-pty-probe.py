#!/usr/bin/env python3
"""Drive an agent CLI under a real PTY the way the runner does (spawn, wait for
composer, bracketed paste, CR) and report what the screen showed. Verdicts and a
masked screen tail only. Usage: sealed-pty-probe.py <seconds> -- <argv...>"""
import os, pty, re, select, sys, time
secs = int(sys.argv[1]); argv = sys.argv[sys.argv.index("--") + 1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
buf = b""; t0 = time.time(); pasted = None
def pump(t):
    global buf
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: d = os.read(fd, 65536)
            except OSError: return False
            if not d: return False
            buf += d
            # answer terminal queries like xterm would (DA1 / cursor position)
            if b"\x1b[c" in d or b"\x1b[0c" in d: os.write(fd, b"\x1b[?1;2c")
            if b"\x1b[6n" in d: os.write(fd, b"\x1b[1;1R")
    return True
ANSI = re.compile(rb"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]")
txt = lambda b: ANSI.sub(b"", b).decode("utf8", "replace")
alive = True
while time.time() - t0 < 60 and alive:
    alive = pump(0.5)
    if re.search(r"type your message|tips for getting started", txt(buf), re.I): break
composer = bool(re.search(r"type your message|tips for getting started", txt(buf), re.I))
print(f"  composer seen: {composer} after {time.time()-t0:.1f}s, alive={alive}, bytes={len(buf)}")
mark = len(buf)
if alive:
    os.write(fd, b"\x1b[200~" + os.environ.get("PROBE_PROMPT","Reply with the single word PONG and nothing else.").encode() + b"\x1b[201~")
    time.sleep(0.25); os.write(fd, b"\r"); time.sleep(0.55); os.write(fd, b"\r")
    pump(secs)
after = txt(buf[mark:])
print(f"  after submit: bytes={len(buf)-mark} esc-to-cancel={bool(re.search(r'esc to (cancel|interrupt)', after, re.I))} PONG={'PONG' in after}")
for k in ["trust", "auth", "login", "api key", "error", "quota", "network", "ECONN", "fetch failed"]:
    if k.lower() in txt(buf).lower(): print(f"  screen mentions: {k}")
lines = [re.sub(r"[─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║]+", " ", l).strip() for l in re.split(r"\r?\n|\r", txt(buf))]
lines = [re.sub(r"\s+", " ", l) for l in lines if len(l.strip()) > 1]
seen = []
for l in lines:
    if l not in seen: seen.append(l)
print("  -- composer screen --")
for l in dict.fromkeys(re.sub(r"\s+"," ",x).strip() for x in re.split(r"\r?\n|\r", txt(buf[:mark]))):
    if len(l)>1: print("  c| " + l[:160])
print("  -- after submit (unique) --")
for l in seen[-60:]:
    print("  | " + re.sub(r"[A-Za-z0-9_-]{28,}", "<masked>", l)[:160])
try: os.kill(pid, 9)
except Exception: pass
