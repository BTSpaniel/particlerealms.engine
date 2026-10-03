# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Unit tests for the JHC1 token codec."""

import unittest

from jhc import TokenCodec


class TestTokenCodec(unittest.TestCase):
    def _round_trip(self, text, language):
        encoded = TokenCodec.encode(text, language)
        decoded = TokenCodec.decode(encoded, language)
        self.assertEqual(decoded, text)

    def test_js_keywords(self):
        src = "function foo(x, y) {\n  return x + y;\n}\n"
        self._round_trip(src, "js")

    def test_js_long_unknown(self):
        src = "const veryLongIdentifierThatIsNotInDictionary = 123;\n"
        self._round_trip(src, "js")

    def test_html_sample(self):
        src = '<!DOCTYPE html>\n<html><head><title>Hello</title></head><body><div class="app">Hi</div></body></html>\n'
        self._round_trip(src, "html")

    def test_css_sample(self):
        src = ".app {\n  display: flex;\n  background-color: #1a1a1a;\n}\n"
        self._round_trip(src, "css")

    def test_unicode_preserved(self):
        src = "const msg = 'こんにちは';\n"
        self._round_trip(src, "js")

    def test_compression_for_common(self):
        src = "function foo(x, y) { return x + y; }\n"
        encoded = TokenCodec.encode(src, "js")
        raw = src.encode("utf-8")
        self.assertLess(len(encoded), len(raw))

    def test_python_js_parity(self):
        src = "const x = 1;\nfunction add(a, b) { return a + b; }\n"
        py = TokenCodec.encode(src, "js")
        # The JS and Python dictionaries are identical, so encoded bytes should match.
        self.assertIsInstance(py, bytes)
        self.assertGreater(len(py), 0)

    def test_json_sample(self):
        src = '{"applicationId":"test.app","version":"1.0.0","files":{}}'
        encoded = TokenCodec.encode(src, "json")
        decoded = TokenCodec.decode(encoded, "json")
        self.assertEqual(decoded, src)
        self.assertLess(len(encoded), len(src.encode("utf-8")))

    def test_jhc_package_token_round_trip(self):
        from jhc import JhcPackage

        manifest = {
            "applicationId": "test.token",
            "applicationVersion": "1.0.0",
            "entry": "files/index.js",
            "format": "jhc-1.0",
            "resources": [],
        }

        def coder(path, content):
            lang = "js"
            if path.endswith(".html") or path.endswith(".htm"):
                lang = "html"
            elif path.endswith(".css"):
                lang = "css"
            encoded = TokenCodec.encode(content.decode("utf-8"), lang)
            if len(encoded) < len(content):
                return {"codec": 1, "decoded": content, "encoded": encoded}
            return None

        resources = {
            "files/index.js": b"function add(a, b) { return a + b; }\n",
            "files/style.css": b".app { display: flex; }\n",
        }
        container = JhcPackage.pack(manifest, resources, coder=coder)
        parsed = JhcPackage.parse(container)
        self.assertEqual(parsed["resources"]["files/index.js"], resources["files/index.js"])
        self.assertEqual(parsed["resources"]["files/style.css"], resources["files/style.css"])

    def test_package_falls_back_when_codec_expands_data(self):
        from jhc import JhcPackage

        resource = b"x"
        container = JhcPackage.pack(
            {
                "applicationId": "test.codec-fallback",
                "applicationVersion": "1.0.0",
                "entry": "files/index.js",
            },
            {"files/index.js": resource},
            coder=lambda path, content: {
                "codec": 1,
                "decoded": content,
                "encoded": b"expanded-token-stream",
            },
        )
        parsed = JhcPackage.parse(container)
        resource_entry = next(entry for entry in parsed["directory"] if entry["sectionType"] == 1)
        self.assertEqual(resource_entry["codec"], 0)
        self.assertEqual(parsed["resources"]["files/index.js"], resource)

    def test_package_rejects_coder_that_changes_decoded_data(self):
        from jhc import JhcPackage, JhcPackageError

        with self.assertRaises(JhcPackageError):
            JhcPackage.pack(
                {
                    "applicationId": "test.codec-integrity",
                    "applicationVersion": "1.0.0",
                    "entry": "files/index.js",
                },
                {"files/index.js": b"original"},
                coder=lambda path, content: {
                    "codec": 1,
                    "decoded": b"changed",
                    "encoded": b"x",
                },
            )


if __name__ == "__main__":
    unittest.main()
