# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Unit test for JHC1 fixture cross-language parity (Python parse)."""

import json
import unittest
from pathlib import Path

from jhc import JhcPackage, TokenCodec


class TestFixtures(unittest.TestCase):
    @staticmethod
    def _token_coder(path, content):
        language = "js"
        if path.endswith((".html", ".htm")):
            language = "html"
        elif path.endswith(".css"):
            language = "css"
        elif path.endswith(".json"):
            language = "json"
        return {
            "codec": 1,
            "decoded": content,
            "encoded": TokenCodec.encode(content.decode("utf-8"), language),
        }

    def test_all_fixtures(self):
        base = Path(__file__).resolve().parent / "fixtures"
        index = json.loads((base / "fixtures.json").read_text(encoding="utf-8"))
        for name in index["fixtures"]:
            with self.subTest(name=name):
                fixture_dir = base / name
                container = (fixture_dir / "expected.jhcraw").read_bytes()
                decoded_dir = fixture_dir / "expected-decoded"
                expected = {}
                if decoded_dir.exists():
                    for p in decoded_dir.rglob("*"):
                        if p.is_file():
                            rel = p.relative_to(decoded_dir).as_posix()
                            expected[rel] = p.read_bytes()
                parsed = JhcPackage.parse(container)
                for rel, expected_bytes in expected.items():
                    self.assertIn(rel, parsed["resources"], f"{name}: missing {rel}")
                    self.assertEqual(parsed["resources"][rel], expected_bytes, f"{name}: {rel} mismatch")

                # Golden files are Python-produced. Repacking their parsed
                # canonical state must reproduce every byte, and the browser
                # performs the same operation with the JavaScript implementation.
                coder = self._token_coder if name == "token-codec" else None
                repacked = JhcPackage.pack(parsed["manifest"], parsed["resources"], coder=coder)
                self.assertEqual(repacked, container, f"{name}: Python repack is not byte-identical")


if __name__ == "__main__":
    unittest.main()
