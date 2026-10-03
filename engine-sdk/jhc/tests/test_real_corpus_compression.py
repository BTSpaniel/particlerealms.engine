# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Compression and package-integrity gates over real first-party source text."""

import gzip
from pathlib import Path
import unittest

from jhc import JhcPackage, TokenCodec


ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOTS = ("engine", "editor", "plauna", "agi", "webgpu-os")
TEXT_SUFFIXES = {".js", ".mjs", ".css", ".html", ".json"}
EXCLUDED_PARTS = {"vendor", "node_modules", "kaolin", "physx", "release", "build", "dist"}
MAX_FILES = 128
MAX_CORPUS_BYTES = 2 * 1024 * 1024


def _language(path: Path) -> str:
    if path.suffix in {".html", ".htm"}:
        return "html"
    if path.suffix == ".css":
        return "css"
    if path.suffix == ".json":
        return "json"
    return "js"


def _collect_corpus():
    corpus = []
    total = 0
    candidates = []
    for root_name in SOURCE_ROOTS:
        candidates.extend((ROOT / root_name).rglob("*"))
    for path in sorted(candidates, key=lambda item: item.as_posix()):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if any(part.lower() in EXCLUDED_PARTS for part in path.parts):
            continue
        try:
            content = path.read_bytes()
            content.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if not content or len(content) > 256 * 1024:
            continue
        if corpus and (len(corpus) >= MAX_FILES or total + len(content) > MAX_CORPUS_BYTES):
            break
        corpus.append((path, content))
        total += len(content)
    return corpus


class TestRealCorpusCompression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.corpus = _collect_corpus()
        cls.raw = b"\n".join(content for _, content in cls.corpus)
        if len(cls.corpus) < 50 or len(cls.raw) < 500_000:
            raise AssertionError(
                f"Representative corpus is too small: {len(cls.corpus)} files, {len(cls.raw)} bytes"
            )

    def test_token_codec_round_trips_every_real_source(self):
        for path, content in self.corpus:
            with self.subTest(path=path.relative_to(ROOT).as_posix()):
                language = _language(path)
                encoded = TokenCodec.encode(content.decode("utf-8"), language)
                decoded = TokenCodec.decode(encoded, language).encode("utf-8")
                self.assertEqual(decoded, content)

    def test_transport_compression_reduces_real_corpus(self):
        gzip_bytes = gzip.compress(self.raw, compresslevel=9, mtime=0)
        self.assertLess(len(gzip_bytes), len(self.raw))
        try:
            import brotli
        except ImportError:
            return
        brotli_bytes = brotli.compress(self.raw, quality=11)
        self.assertLessEqual(len(brotli_bytes), len(gzip_bytes))

    def test_adaptive_package_never_stores_expanded_bytecode(self):
        resources = {}
        languages = {}
        for index, (path, content) in enumerate(self.corpus):
            logical_path = f"files/corpus/{index:04d}{path.suffix.lower()}"
            resources[logical_path] = content
            languages[logical_path] = _language(path)

        def token_coder(path, content):
            encoded = TokenCodec.encode(content.decode("utf-8"), languages[path])
            # Deliberately return every result. JhcPackage itself must enforce
            # the smaller-only storage policy.
            return {"codec": 1, "decoded": content, "encoded": encoded}

        container = JhcPackage.pack(
            {
                "applicationId": "test.real-corpus",
                "applicationVersion": "1.0.0",
                "entry": next(iter(resources)),
            },
            resources,
            coder=token_coder,
        )
        parsed = JhcPackage.parse(container)
        self.assertEqual(parsed["resources"], resources)
        entries = [entry for entry in parsed["directory"] if entry["sectionType"] == 1]
        self.assertEqual(len(entries), len(resources))
        for entry in entries:
            self.assertIn(entry["codec"], (0, 1))
            self.assertLessEqual(entry["storedLength"], entry["decodedLength"])
            if entry["codec"] == 1:
                self.assertLess(entry["storedLength"], entry["decodedLength"])


if __name__ == "__main__":
    unittest.main()
