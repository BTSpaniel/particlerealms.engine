# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Serve an extracted SDK on localhost using only the Python standard library."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class SDKRequestHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".wgsl": "text/plain",
        ".json": "application/json",
        ".gz": "application/octet-stream",
        ".br": "application/octet-stream",
        ".bin": "application/octet-stream",
    }

    def __init__(self, *args, isolate=False, **kwargs):
        self.isolate = isolate
        super().__init__(*args, **kwargs)

    def send_head(self):
        root = Path(self.directory).resolve()
        target = Path(self.translate_path(self.path)).resolve()
        if not target.is_relative_to(root):
            self.send_error(403, "The requested file is outside the SDK root")
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if self.isolate:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()


class SDKHTTPServer(ThreadingHTTPServer):
    # Large source graphs and credentialless frames each open their own pool
    # of connections. Keep the pending queue large enough for these bursts.
    request_queue_size = 128
    daemon_threads = True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent,
                        help="SDK directory to serve (default: directory containing this script)")
    parser.add_argument("--port", type=int, default=9001)
    parser.add_argument("--isolate", action="store_true",
                        help="Enable cross-origin isolation for threaded compute")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if not root.is_dir():
        parser.error(f"SDK root is not a directory: {root}")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    handler = partial(SDKRequestHandler, directory=str(root), isolate=args.isolate)
    with SDKHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"[SDK server] root={root} url=http://127.0.0.1:{args.port}/ isolate={args.isolate}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[SDK server] stopped", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
