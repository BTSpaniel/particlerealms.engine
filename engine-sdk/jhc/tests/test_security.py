# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Authentication-before-decode and cross-language signature tests."""

import json
import unittest
from pathlib import Path

from jhc import JhcPackage, JhcPackageError


class TestPackageSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_dir = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
        cls.container = (cls.fixture_dir / "jhc1-hello.jhc").read_bytes()
        cls.sidecar = json.loads((cls.fixture_dir / "jhc1-hello.json").read_text(encoding="utf-8"))
        cls.public_key = bytes.fromhex(cls.sidecar["publicKeyHex"])

    def test_python_verifies_browser_compatible_signed_fixture(self):
        result = JhcPackage.verify(
            self.container,
            {self.sidecar["fingerprint"]: self.public_key},
        )
        self.assertTrue(result["ok"], result["diagnostics"])
        self.assertEqual(result["verdict"], "trusted")
        self.assertEqual(result["rootHash"], self.sidecar["rootHash"])

    def test_authenticated_parse_rejects_signature_tamper_before_decode(self):
        prepared = JhcPackage.preflight(self.container)
        signature_entry = next(e for e in prepared["directory"] if e["sectionType"] == 4)
        tampered = bytearray(self.container)
        tampered[signature_entry["storedOffset"]] ^= 1
        with self.assertRaises(JhcPackageError) as ctx:
            JhcPackage.parse_authenticated(bytes(tampered), self.public_key)
        self.assertEqual(ctx.exception.code, 205)

    def test_unsigned_parse_is_inspectable_but_not_trusted(self):
        unsigned = JhcPackage.pack(
            {"applicationId": "test.unsigned", "applicationVersion": "1.0.0", "entry": "files/a.js"},
            {"files/a.js": b"export default 1"},
        )
        self.assertEqual(JhcPackage.parse(unsigned)["resources"]["files/a.js"], b"export default 1")
        verdict = JhcPackage.verify(unsigned)
        self.assertFalse(verdict["ok"])
        self.assertEqual(verdict["verdict"], "unsigned")
        with self.assertRaises(JhcPackageError) as ctx:
            JhcPackage.parse_authenticated(unsigned, self.public_key)
        self.assertEqual(ctx.exception.code, 124)


if __name__ == "__main__":
    unittest.main()
