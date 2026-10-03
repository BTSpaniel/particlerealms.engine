# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Tests for the final Chromium-backed bundle syntax gate."""

import unittest
from unittest import mock

from bundler.browser_syntax import assert_browser_classic_script_syntax
from bundler.parser import ParseError


class TestBrowserSyntax(unittest.TestCase):
    def test_accepts_valid_classic_script(self):
        assert_browser_classic_script_syntax(
            "(() => { const value = 1; globalThis.answer = value; })();",
            label="valid-fixture.js",
        )

    def test_rejects_default_class_assignment_without_boundary(self):
        malformed = "__e.__default = class Demo {} function helper() {}"
        with self.assertRaisesRegex(
            ParseError,
            r"invalid-fixture\.js failed final browser syntax validation: FAIL SyntaxError",
        ):
            assert_browser_classic_script_syntax(malformed, label="invalid-fixture.js")

    def test_dependency_free_chromium_fallback_is_bounded(self):
        with mock.patch("bundler.browser_syntax.sync_playwright", None):
            assert_browser_classic_script_syntax(
                "globalThis.fallbackParsed = true;",
                label="fallback-fixture.js",
                timeout_seconds=30,
            )


if __name__ == "__main__":
    unittest.main()
