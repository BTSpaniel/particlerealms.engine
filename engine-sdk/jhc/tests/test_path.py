# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Unit tests for the JHC canonical path validator."""

import unittest

from jhc import (
    JhcPathError,
    canonicalize,
    validate,
    is_valid,
    validate_many,
    validate_id,
    is_valid_id,
    validate_version,
    is_valid_version,
)


class TestCanonicalize(unittest.TestCase):
    def test_simple_relative(self):
        self.assertEqual(canonicalize("files/index.js"), "files/index.js")

    def test_leading_segment(self):
        self.assertEqual(canonicalize("assets/style.css"), "assets/style.css")

    def test_deeply_nested(self):
        self.assertEqual(canonicalize("a/b/c/d.js"), "a/b/c/d.js")

    def test_rejects_empty(self):
        with self.assertRaises(JhcPathError):
            canonicalize("")

    def test_rejects_non_string(self):
        with self.assertRaises(JhcPathError):
            canonicalize(None)

    def test_rejects_absolute(self):
        with self.assertRaises(JhcPathError):
            canonicalize("/files/index.js")

    def test_rejects_backslash(self):
        with self.assertRaises(JhcPathError):
            canonicalize("files\\index.js")

    def test_rejects_drive_letter(self):
        with self.assertRaises(JhcPathError):
            canonicalize("C:/files/index.js")

    def test_rejects_traversal(self):
        with self.assertRaises(JhcPathError):
            canonicalize("files/../index.js")

    def test_rejects_double_traversal(self):
        with self.assertRaises(JhcPathError):
            canonicalize("files/../../etc/passwd")

    def test_rejects_dot_segment(self):
        with self.assertRaises(JhcPathError):
            canonicalize("files/./index.js")

    def test_rejects_empty_segment(self):
        with self.assertRaises(JhcPathError):
            canonicalize("files//index.js")

    def test_rejects_null_byte(self):
        with self.assertRaises(JhcPathError):
            canonicalize("files/index\x00.js")

    def test_rejects_encoded_null(self):
        with self.assertRaises(JhcPathError):
            canonicalize("files/index%00.js")

    def test_rejects_overlong_slash(self):
        with self.assertRaises(JhcPathError):
            canonicalize("files%2f..%2findex.js")

    def test_rejects_reserved_characters(self):
        for char in ("?", "#", "*", "|", "<", ">", '"'):
            with self.subTest(char=char):
                with self.assertRaises(JhcPathError):
                    canonicalize(f"files/index{char}.js")

    def test_percent_encoding_decodes(self):
        self.assertEqual(canonicalize("files/index%20name.js"), "files/index name.js")

    def test_unicode_paths(self):
        self.assertEqual(canonicalize("files/café.js"), "files/café.js")
        self.assertEqual(canonicalize("files/%C3%A9.js"), "files/é.js")

    def test_dotfiles_allowed(self):
        self.assertEqual(canonicalize("files/.gitignore"), "files/.gitignore")

    def test_is_valid(self):
        self.assertTrue(is_valid("files/index.js"))
        self.assertFalse(is_valid("files/../index.js"))


class TestValidateMany(unittest.TestCase):
    def test_all_valid(self):
        result = validate_many(["files/a.js", "files/b.js"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["canonicals"], ["files/a.js", "files/b.js"])
        self.assertEqual(result["errors"], [])

    def test_duplicate_detected(self):
        result = validate_many(["files/a.js", "files/a.js"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["canonicals"], ["files/a.js"])
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["errors"][0]["code"], 103)

    def test_mixed(self):
        result = validate_many(["files/a.js", "../b.js", "files/a.js"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["canonicals"], ["files/a.js"])
        self.assertEqual(len(result["errors"]), 2)


class TestValidateId(unittest.TestCase):
    def test_valid_ids(self):
        self.assertEqual(validate_id("community.my-app"), "community.my-app")
        self.assertEqual(validate_id("a"), "a")
        self.assertEqual(validate_id("os.my-app-v2"), "os.my-app-v2")

    def test_invalid_ids(self):
        for bad in ("", "MyApp", "-app", "app.", "app..name", "app name"):
            with self.subTest(bad=bad):
                self.assertFalse(is_valid_id(bad))


class TestValidateVersion(unittest.TestCase):
    def test_valid_versions(self):
        self.assertEqual(validate_version("1.0.0"), "1.0.0")
        self.assertEqual(validate_version("1.0.0-alpha"), "1.0.0-alpha")
        self.assertEqual(validate_version("1.0.0+build"), "1.0.0+build")
        self.assertEqual(validate_version("1.0.0-rc.1"), "1.0.0-rc.1")

    def test_invalid_versions(self):
        for bad in ("", "1.0.0-", "1..0", "1.0.0/alpha", "1 0", "1.0.0."):
            with self.subTest(bad=bad):
                self.assertFalse(is_valid_version(bad))


if __name__ == "__main__":
    unittest.main()
