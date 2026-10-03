# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Tests for the offline, hash-verified adaptive codec policy."""

import tempfile
import unittest
from pathlib import Path

from jhc.tools.adaptive_codec_lab import build_policy, extract_features, predict, verify_policy


class TestAdaptiveCodecLab(unittest.TestCase):
    def test_policy_is_deterministic_and_integrity_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(8):
                (root / f"sample-{index}.js").write_text(
                    ("export function repeatedName(value) { return value + repeatedName; }\n" * (index + 1)),
                    encoding="utf-8",
                )
            first = build_policy([root], max_depth=3, min_leaf=2)
            second = build_policy([root], max_depth=3, min_leaf=2)
            self.assertEqual(first, second)
            payload = verify_policy(first)
            self.assertIsInstance(predict(payload["model"], extract_features(b"export default 1")), bool)
            first["training"]["files"] += 1
            with self.assertRaises(ValueError):
                verify_policy(first)


if __name__ == "__main__":
    unittest.main()
