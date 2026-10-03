# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Fail closed when accepted documentation examples disappear or change shape."""
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main

from sdk.doc_snippets import EXAMPLES, extract_sdk_doc_snippets


class SDKDocumentationSnippetTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="sdk-doc-snippets-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for identifier, (relative, _, _) in EXAMPLES.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("ab") as stream:
                stream.write((f"<!-- sdk-example: {identifier} -->\r\n\r\n"
                              "```javascript\r\nconst message = 'exact bytes';\r\n```\r\n").encode("utf-8"))

    def document(self, identifier="engine-source"):
        return self.root / EXAMPLES[identifier][0]

    def test_extracts_actual_fence_bytes_location_and_identity(self):
        examples = extract_sdk_doc_snippets(self.root)
        self.assertEqual([item["id"] for item in examples], list(EXAMPLES))
        for item in examples:
            with self.subTest(identifier=item["id"]):
                self.assertEqual(item["code"], "const message = 'exact bytes';\r\n")
                self.assertEqual(item["sha256"], hashlib.sha256(item["code"].encode()).hexdigest())
                lines = (self.root / item["path"]).read_bytes().splitlines(keepends=True)
                self.assertEqual(lines[item["line"] - 1].decode(), item["code"])
                self.assertEqual((item["mode"], item["kind"]), EXAMPLES[item["id"]][1:])

    def test_changed_markdown_changes_executed_bytes_and_digest(self):
        before = extract_sdk_doc_snippets(self.root)[0]
        path = self.document()
        path.write_bytes(path.read_bytes().replace(b"exact bytes", b"changed bytes", 1))
        after = extract_sdk_doc_snippets(self.root)[0]
        self.assertIn("changed bytes", after["code"])
        self.assertNotEqual(after["sha256"], before["sha256"])

    def test_missing_example_does_not_silently_reduce_coverage(self):
        path = self.document()
        path.write_bytes(path.read_bytes().replace(b"<!-- sdk-example: engine-source -->", b"<!-- removed -->"))
        with self.assertRaisesRegex(ValueError, "Missing SDK examples: engine-source"):
            extract_sdk_doc_snippets(self.root)

    def test_duplicate_example_is_rejected(self):
        path = self.document()
        path.write_bytes(path.read_bytes() + path.read_bytes())
        with self.assertRaisesRegex(ValueError, "Duplicate SDK example"):
            extract_sdk_doc_snippets(self.root)

    def test_unknown_or_misplaced_example_is_rejected(self):
        path = self.document()
        path.write_bytes(path.read_bytes().replace(b"engine-source", b"plauna-source", 1))
        with self.assertRaisesRegex(ValueError, "Unknown or misplaced SDK example"):
            extract_sdk_doc_snippets(self.root)

    def test_non_javascript_or_detached_fence_is_rejected(self):
        path = self.document()
        original = path.read_bytes()
        for replacement in (b"```python", b"Additional prose\r\n```javascript"):
            with self.subTest(replacement=replacement):
                path.write_bytes(original.replace(b"```javascript", replacement, 1))
                with self.assertRaisesRegex(ValueError, "immediately precede a JavaScript fence"):
                    extract_sdk_doc_snippets(self.root)

    def test_empty_and_unterminated_examples_are_rejected(self):
        path = self.document()
        prefix = b"<!-- sdk-example: engine-source -->\n```javascript\n"
        for payload, message in ((prefix + b"```\n", "Empty"), (prefix + b"const a = 1;\n", "Unclosed")):
            with self.subTest(message=message):
                path.write_bytes(payload)
                with self.assertRaisesRegex(ValueError, message):
                    extract_sdk_doc_snippets(self.root)

    def test_canonical_inventory_has_every_supported_example(self):
        root = Path(__file__).resolve().parents[2]
        examples = extract_sdk_doc_snippets(root)
        self.assertEqual(len(examples), 3)
        self.assertTrue(all(item["code"].strip() for item in examples))


if __name__ == "__main__":
    main()
