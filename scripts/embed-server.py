#!/usr/bin/env python3
"""Local OpenAI-compatible embeddings server for Loki's fleet-knowledge RAG.

No cloud key: runs BAAI/bge-small-en-v1.5 (384-dim) on CPU via fastembed/onnxruntime.
Speaks just enough of the OpenAI /v1/embeddings shape that our provider-agnostic
embeddings.ts can point EMBEDDINGS_BASE_URL at http://127.0.0.1:7997/v1 unchanged.

Bind: 127.0.0.1:7997 (loopback only — the box app + hosted runner reach it locally).
"""
import json
import os
import select
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from fastembed import TextEmbedding

MODEL_NAME = os.environ.get("EMBED_MODEL", "BAAI/bge-small-en-v1.5")  # 384-dim
PORT = int(os.environ.get("EMBED_PORT", "7997"))

print(f"[embed] loading {MODEL_NAME} …", flush=True)
_model = TextEmbedding(model_name=MODEL_NAME)
# Warm + discover dimension.
_dim = len(next(iter(_model.embed(["warmup"]))).tolist())
print(f"[embed] ready: {MODEL_NAME} dim={_dim} on :{PORT}", flush=True)

# One inference at a time. ThreadingHTTPServer gives every request its own
# thread, and onnxruntime grows a memory arena per concurrent run that it never
# returns: the 03:30 reindex plus live callers took this process to 2GB, filled
# the box's swap, and starved Postgres until other apps' crons failed
# (2026-11-06). Requests queue here instead; small batches keep the wait short.
_infer_lock = threading.Lock()
BATCH_SIZE = int(os.environ.get("EMBED_BATCH_SIZE", "16"))


def _caller_gone(conn: socket.socket) -> bool:
    """True once the caller has hung up, e.g. because its timeout fired.

    The lock alone turned one slow batch into a failed reindex (2026-11-07).
    The client aborts at 30s, but this server kept computing the abandoned
    request under the lock, so the next request queued behind dead work, timed
    out in turn and left its own dead work behind. From then on every batch
    failed until systemd killed the run at 15 minutes. So work nobody is
    waiting for is dropped: checked when the lock is taken and between batches.

    The body has already been read, so a readable socket means EOF or a reset,
    not more data. A peek that returns bytes (a next request on a keep-alive
    connection) means the caller is still there.
    """
    try:
        readable, _, _ = select.select([conn], [], [], 0)
        if not readable:
            return False
        return conn.recv(1, socket.MSG_PEEK) == b""
    except (OSError, ValueError):
        return True


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # health + model list
        if self.path.rstrip("/") in ("/health", "/v1/health"):
            self._send(200, {"status": "ok", "model": MODEL_NAME, "dim": _dim})
        elif self.path.rstrip("/") == "/v1/models":
            self._send(200, {"object": "list", "data": [{"id": MODEL_NAME, "object": "model"}]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/v1/embeddings":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length) or b"{}")
            inp = req.get("input", "")
            texts = [inp] if isinstance(inp, str) else list(inp)
            if not texts:
                self._send(400, {"error": "input required"})
                return
            with _infer_lock:
                vectors = []
                if not _caller_gone(self.connection):
                    for v in _model.embed(texts, batch_size=BATCH_SIZE):
                        vectors.append(v.tolist())
                        done = len(vectors)
                        if done < len(texts) and done % BATCH_SIZE == 0 and _caller_gone(self.connection):
                            break
            if len(vectors) < len(texts):
                print(f"[embed] caller hung up, dropped {len(texts) - len(vectors)}/{len(texts)} input(s)", flush=True)
                self.close_connection = True
                return
            data = [{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)]
            self._send(200, {
                "object": "list",
                "data": data,
                "model": req.get("model", MODEL_NAME),
                "usage": {"prompt_tokens": 0, "total_tokens": 0},
            })
        except Exception as e:  # surface, don't crash the server
            self._send(500, {"error": str(e)})

    def log_message(self, *args) -> None:  # quiet
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
