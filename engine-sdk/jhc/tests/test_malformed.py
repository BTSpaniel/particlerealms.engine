# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Unit tests for malformed JHC1 corpus."""

import json
import unittest
from pathlib import Path

from jhc import JhcPackage, JhcPackageError


class TestMalformedCorpus(unittest.TestCase):
    def test_malformed_cases(self):
        base = Path(__file__).resolve().parent / "malformed"
        index = json.loads((base / "index.json").read_text(encoding="utf-8"))
        for case in index["cases"]:
            data = (base / f"{case['name']}.jhc").read_bytes()
            with self.subTest(name=case["name"]):
                with self.assertRaises(JhcPackageError) as ctx:
                    JhcPackage.parse(data)
                self.assertEqual(ctx.exception.code, case["expectedCode"])


if __name__ == "__main__":
    unittest.main()
