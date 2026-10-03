# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Exercise the SDK server's MIME, isolation and root containment contracts."""

from functools import partial
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from unittest import TestCase, main
from urllib.error import HTTPError
from urllib.request import urlopen

from sdk.server import SDKHTTPServer, SDKRequestHandler


class QuietHandler(SDKRequestHandler):
    def log_message(self, *args):
        pass


class SDKServerTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="sdk-server-test-")
        self.root = Path(self.temporary.name)
        (self.root / "entry.mjs").write_text("export const value = 1;\n", encoding="utf-8")
        (self.root / "module.wasm").write_bytes(b"\0asm\1\0\0\0")
        (self.root / "runtime.gz").write_bytes(b"compressed-transport-bytes")
        self.servers = []

    def tearDown(self):
        for server, thread in self.servers:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        self.temporary.cleanup()

    def serve(self, isolate=False):
        handler = partial(QuietHandler, directory=str(self.root), isolate=isolate)
        server = SDKHTTPServer(("127.0.0.1", 0), handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.servers.append((server, thread))
        return f"http://127.0.0.1:{server.server_port}"

    def test_plain_server_sets_mime_without_transforming_transport(self):
        base = self.serve()
        for name, expected in (("entry.mjs", "text/javascript"), ("module.wasm", "application/wasm"), ("runtime.gz", "application/octet-stream")):
            with self.subTest(name=name), urlopen(f"{base}/{name}") as response:
                self.assertEqual(response.headers.get_content_type(), expected)
                self.assertEqual(response.read(), (self.root / name).read_bytes())
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                self.assertIsNone(response.headers["Content-Encoding"])
                self.assertIsNone(response.headers["Cross-Origin-Embedder-Policy"])

    def test_isolation_headers_are_opt_in(self):
        with urlopen(f"{self.serve(isolate=True)}/entry.mjs") as response:
            self.assertEqual(response.headers["Cross-Origin-Opener-Policy"], "same-origin")
            self.assertEqual(response.headers["Cross-Origin-Embedder-Policy"], "require-corp")
            self.assertEqual(response.headers["Cross-Origin-Resource-Policy"], "same-origin")

    def test_symlink_cannot_escape_the_served_root(self):
        with TemporaryDirectory(prefix="sdk-server-outside-") as outside:
            secret = Path(outside) / "outside.txt"
            secret.write_text("outside the SDK", encoding="utf-8")
            try:
                (self.root / "escape.txt").symlink_to(secret)
            except OSError as error:
                self.skipTest(f"Symlink creation is unavailable: {error}")
            with self.assertRaises(HTTPError) as failure:
                urlopen(f"{self.serve()}/escape.txt")
            self.assertEqual(failure.exception.code, 403)


if __name__ == "__main__":
    main()
