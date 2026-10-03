# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Legacy minifiers must preserve regex bytes and JavaScript operator boundaries."""

import unittest
from unittest import mock

from bundler import builder
from bundler.browser_syntax import _find_browser, sync_playwright


_FIXTURES = (
    (
        "multistorey-wall-filter",
        r"""const instances = [{groupPath:'walls/front/stud'}, {groupPath:'floor/joist'}];
return instances.filter(item => /walls\/(front|right|rear|left|stair-hall)\//.test(item.groupPath)).length;""",
        1,
    ),
    ("arrow-character-class", r"const check = s => /a[ ]b/.test(s); return [check('a b'), check('ab')];", [True, False]),
    ("arrow-comment", r"const check = s => /* remove */ /a\/\//.test(s); return check('a//');", True),
    ("typeof", r"return typeof /a\/\//;", "object"),
    ("void", r"return (void /a\/\//) === undefined;", True),
    ("throw", r"try { throw /a\/\//; } catch (error) { return error.source; }", r"a\/\/"),
    ("comparison", r"return 2 > /a\/\//.test('a//');", True),
    ("shift", r"return 4 >> /a\/\//.test('a//');", 2),
    ("division-before-regex", r"return 8 / /2/.source.length;", 8),
    ("division-after-regex", r"return /2/.source.length / 2;", 0.5),
    ("member-keyword-division", r"const obj = {return:24}; return obj.return / 2 / 3;", 4),
    ("member-keyword-comment", "const obj = {return:24}; return obj.return /2/* ' */;", 12),
    ("contextual-keyword-division", "const of = 24; return of / 2 / 3;", 4),
    ("object-division", "const value = {valueOf(){return 24}} / 2 / 3; return value;", 4),
    ("template-regex", r"const value = `raw ${/a\/\//.test('a//') ? ` nested ` : ''} tail`; return value;", "raw  nested  tail"),
    ("template-division-after-arrow", "const x=6,y=3; const f=()=>`${x / y}/foo`; return f();", "2/foo"),
    ("template-division-after-keyword", "const x=6,y=3; return typeof `${x / y}/foo`;", "string"),
)


def _legacy_minify(source, use_rjsmin):
    with mock.patch.object(builder, "HAS_ESBUILD", False), mock.patch.object(builder, "HAS_RJSMIN", use_rjsmin):
        return builder.minify_source(source)


class TestRegexLiteralMinification(unittest.TestCase):
    def test_actual_wall_filter_regex_is_preserved_by_both_legacy_minifiers(self):
        literal = r"/walls\/(front|right|rear|left|stair-hall)\//"
        source = _FIXTURES[0][1]
        for use_rjsmin in (False, True):
            if use_rjsmin and not builder.HAS_RJSMIN:
                continue
            with self.subTest(minifier="rjsmin" if use_rjsmin else "JSMin"):
                result = _legacy_minify(source, use_rjsmin)
                self.assertIn(literal, result)
                self.assertIn(".test(item.groupPath)", result)

    def test_esbuild_result_bypasses_legacy_literal_protection(self):
        with mock.patch.object(builder, "HAS_ESBUILD", True), mock.patch.object(builder, "_minify_esbuild", return_value="native result"):
            self.assertEqual(builder.minify_source("input"), "native result")


@unittest.skipIf(sync_playwright is None, "Playwright is required for minifier runtime parity")
class TestRegexMinificationRuntime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=str(_find_browser()), headless=True, args=["--disable-gpu"],
        )
        cls.page = cls.browser.new_page()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def test_native_source_and_each_legacy_minifier_have_identical_results(self):
        for name, source, expected in _FIXTURES:
            with self.subTest(fixture=name, minifier="native source"):
                self.assertEqual(self.page.evaluate("source => new Function(source)()", source), expected)
            for use_rjsmin in (False, True):
                if use_rjsmin and not builder.HAS_RJSMIN:
                    continue
                with self.subTest(fixture=name, minifier="rjsmin" if use_rjsmin else "JSMin"):
                    result = _legacy_minify(source, use_rjsmin)
                    self.assertEqual(self.page.evaluate("source => new Function(source)()", result), expected)


if __name__ == "__main__":
    unittest.main()
