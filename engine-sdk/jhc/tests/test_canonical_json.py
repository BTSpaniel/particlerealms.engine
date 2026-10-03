# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Canonical JSON vectors shared with the browser cross-language suite."""

import unittest

from jhc import JhcPackage


class TestCanonicalJson(unittest.TestCase):
    def test_ecmascript_number_profile(self):
        value = {
            "one": 1.0,
            "negativeZero": -0.0,
            "fixed": 1e-6,
            "small": 1e-7,
            "big": 1e20,
            "huge": 1e21,
        }
        self.assertEqual(
            JhcPackage._canonical_json(value),
            '{"big":100000000000000000000,"fixed":0.000001,"huge":1e+21,'
            '"negativeZero":0,"one":1,"small":1e-7}',
        )

    def test_utf16_key_order_and_ascii_wire_form(self):
        value = {"\U0001f600": "grin", "\ue000": "private", "café": "雪"}
        self.assertEqual(
            JhcPackage._canonical_json(value),
            '{"caf\\u00e9":"\\u96ea","\\ud83d\\ude00":"grin","\\ue000":"private"}',
        )

    def test_unsafe_integer_rejected(self):
        with self.assertRaises(ValueError):
            JhcPackage._canonical_json({"unsafe": 9_007_199_254_740_993})

    def test_large_exact_integer_uses_ecmascript_number_format(self):
        self.assertEqual(
            JhcPackage._canonical_json({"exact": 100_000_000_000_000_000_000}),
            '{"exact":100000000000000000000}',
        )


if __name__ == "__main__":
    unittest.main()
