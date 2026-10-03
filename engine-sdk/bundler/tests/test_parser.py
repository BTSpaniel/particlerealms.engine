# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Tests for bundler.parser."""

import unittest

from bundler.parser import ParseError, parse_module
from bundler.scan_import_paths import scan_import_paths


class TestParser(unittest.TestCase):
    def test_default_import(self):
        imports, exports = parse_module("import foo from './bar.js';\n")
        self.assertEqual(len(imports), 1)
        self.assertEqual(imports[0].spec, './bar.js')
        self.assertEqual(imports[0].default, 'foo')

    def test_named_import(self):
        imports, exports = parse_module("import { a, b } from './baz.js';\n")
        self.assertEqual(len(imports), 1)
        self.assertEqual(imports[0].spec, './baz.js')
        self.assertEqual(imports[0].named, ['a', 'b'])

    def test_namespace_import(self):
        imports, exports = parse_module("import * as lib from './lib.js';\n")
        self.assertEqual(len(imports), 1)
        self.assertEqual(imports[0].spec, './lib.js')
        self.assertEqual(imports[0].namespace, 'lib')

    def test_side_effect_import(self):
        imports, exports = parse_module("import './side.js';\n")
        self.assertEqual(len(imports), 1)
        self.assertEqual(imports[0].spec, './side.js')

    def test_export_default(self):
        imports, exports = parse_module("export default function() {}\n")
        self.assertEqual(len(exports), 1)
        self.assertTrue(exports[0].default)

    def test_export_named(self):
        imports, exports = parse_module("export { a, b };\n")
        self.assertEqual(len(exports), 1)
        self.assertEqual(exports[0].named, ['a', 'b'])

    def test_comments_and_strings_ignored(self):
        source = "// import 'fake.js';\nimport a from './real.js';\n"
        imports, exports = parse_module(source)
        self.assertEqual(len(imports), 1)
        self.assertEqual(imports[0].spec, './real.js')

    def test_mixed_default_named_import(self):
        imports, exports = parse_module("import def, { a, b } from './mod.js';\n")
        self.assertEqual(len(imports), 1)
        self.assertEqual(imports[0].default, 'def')
        self.assertEqual(imports[0].named, ['a', 'b'])
        self.assertEqual(imports[0].spec, './mod.js')

    def test_import_meta_is_not_an_import(self):
        imports, _ = parse_module("const here = import.meta.url;\n")
        self.assertEqual(imports, [])

    def test_multiple_statements_keep_exact_offsets(self):
        source = "const x = 1;\nimport { a as local } from './a.js';\nexport const value = local;\n"
        imports, exports = parse_module(source)
        self.assertEqual(source[imports[0].start:imports[0].end], "import { a as local } from './a.js'")
        self.assertEqual(source[exports[0].start:exports[0].end], "export const value")
        self.assertEqual(imports[0].named, ["a: local"])

    def test_mixed_default_namespace_import(self):
        imports, _ = parse_module("import main, * as api from './mod.js';\n")
        self.assertEqual(imports[0].default, "main")
        self.assertEqual(imports[0].namespace, "api")

    def test_reexport_star(self):
        imports, exports = parse_module("export * from './mod.js';\n")
        self.assertEqual(len(exports), 1)
        self.assertTrue(exports[0].reexport)
        self.assertEqual(exports[0].spec, './mod.js')

    def test_reexport_namespace(self):
        imports, exports = parse_module("export * as ns from './mod.js';\n")
        self.assertEqual(len(exports), 1)
        self.assertTrue(exports[0].reexport)
        self.assertEqual(exports[0].spec, './mod.js')

    def test_export_object_binding_pattern(self):
        source = "export const { direct, key: local = fallback, nested: { deep }, ...rest } = value;\n"
        _, exports = parse_module(source)
        self.assertEqual(exports[0].named, ["direct", "local", "deep", "rest"])

    def test_export_array_binding_pattern(self):
        source = "export let [first, , { item: second = call(1, 2) }, ...tail] = value;\n"
        _, exports = parse_module(source)
        self.assertEqual(exports[0].named, ["first", "second", "tail"])

    def test_export_variable_declaration_list_keeps_every_binding(self):
        for declaration, bindings in (
            ("const", "first = 1, second = 2, third = 3"),
            ("let", "first, second = 2, third"),
            ("var", "first, second, third = 3"),
        ):
            with self.subTest(declaration=declaration):
                source = f"export {declaration} {bindings};\n"
                _, exports = parse_module(source)
                self.assertEqual(len(exports), 1)
                self.assertEqual(exports[0].named, ["first", "second", "third"])
                self.assertEqual(source[exports[0].start:exports[0].end], f"export {declaration} first")

    def test_export_declaration_list_distinguishes_nested_initializer_commas(self):
        source = (
            "export const first = call(1, { list: [2, 3], text: ',' }),\n"
            "  { direct, key: local = call(4, 5), nested: { deep }, ...rest } = source,\n"
            "  [head, , ...tail] = array, pattern = /[,;]/;\n"
        )
        _, exports = parse_module(source)
        self.assertEqual(exports[0].named, ["first", "direct", "local", "deep", "rest", "head", "tail", "pattern"])

    def test_export_declaration_lookahead_keeps_dynamic_imports_visible(self):
        source = (
            "export const first = import('./first.js'),\n"
            "  second = () => { const a = 1, b = 2; return import('./second.js'); },\n"
            "  third = 3;\n"
        )
        imports, exports = parse_module(source)
        self.assertEqual(exports[0].named, ["first", "second", "third"])
        self.assertEqual([item.spec for item in imports], ["./first.js", "./second.js"])

    def test_export_declaration_list_stops_at_automatic_semicolons(self):
        source = (
            "export const first = value\n"
            "local(first, 2), hidden(3)\n"
            "export const second = value\n"
            "  .method(1, 2), third = 3;\n"
            "export let fourth\n"
            "const other = 1, secret = 2;\n"
            "export const fifth = value /* comment with\nnewline */\n"
            "counter++, more();\n"
            "export const sixth = object.class\n"
            "sideEffect(1), hiddenCall(2)\n"
            "export const seventh = object?.function\n"
            "anotherSideEffect(1), anotherHiddenCall(2)\n"
        )
        _, exports = parse_module(source)
        self.assertEqual([item.named for item in exports], [
            ["first"], ["second", "third"], ["fourth"], ["fifth"], ["sixth"], ["seventh"],
        ])

    def test_export_declaration_list_keeps_multiline_expressions_together(self):
        source = (
            "export const first = new\nThing(1, 2), second = left\n"
            "  + right, third = tag\n`x, y`, fourth = 1\n"
            "  , fifth = () =>\n({ a: 1, b: 2 });\n"
        )
        _, exports = parse_module(source)
        self.assertEqual(exports[0].named, ["first", "second", "third", "fourth", "fifth"])

    def test_export_declaration_list_keeps_multiline_classes_and_keyword_operators(self):
        source = (
            "export const first = class Named\nextends Base\n{ method() { return [1, 2]; } },\n"
            "  second = function named()\n{ return 2; }, third = key in\nobject,\n"
            "  fourth = value instanceof\nType, fifth = 5;\n"
        )
        _, exports = parse_module(source)
        self.assertEqual(exports[0].named, ["first", "second", "third", "fourth", "fifth"])

    def test_export_declaration_asi_recognizes_every_javascript_line_terminator(self):
        for newline in ("\n", "\r", "\r\n", "\u2028", "\u2029"):
            for comment in ("", " // statement ends here"):
                with self.subTest(newline=repr(newline), comment=comment):
                    source = f"export const a = 1{comment}{newline}let b = 2, c = 3; export const d = 4;"
                    _, exports = parse_module(source)
                    self.assertEqual([item.named for item in exports], [["a"], ["d"]])

    def test_exported_generators_keep_names_offsets_and_body_imports(self):
        for declaration in (
            "function*", "function *", "async function*", "async function *",
            "async /* modifier */ function /* generator */ *",
        ):
            with self.subTest(declaration=declaration):
                prefix = f"export {declaration} sequence"
                source = prefix + "() { yield import('./next.js'); }\n"
                imports, exports = parse_module(source)
                self.assertEqual(len(exports), 1)
                self.assertEqual(exports[0].named, ["sequence"])
                self.assertEqual(exports[0].declaration, "async function*" if declaration.startswith("async") else "function*")
                self.assertEqual(source[exports[0].start:exports[0].end], prefix)
                self.assertEqual([(item.spec, item.is_dynamic) for item in imports], [("./next.js", True)])

    def test_generator_star_does_not_allow_anonymous_or_invalid_named_exports(self):
        for source in (
            "export function* () {}", "export async function* () {}",
            "export const * value = 1;", "export function** value() {}",
        ):
            with self.subTest(source=source), self.assertRaises(ParseError):
                parse_module(source)

    def test_escaped_specifiers_decode_in_every_dependency_form(self):
        literals = (
            (r"'.\x2fdep.js'", "./dep.js"),
            (r"'./\u0064ep.js'", "./dep.js"),
            (r"'.\u{2F}dep.js'", "./dep.js"),
            (r"'.\u{000002f}dep.js'", "./dep.js"),
            (r"'.\/dep.js'", "./dep.js"),
            (r"'./it\'s.js'", "./it's.js"),
            (r"'./\uD83D\uDE80.js'", "./🚀.js"),
            (r"'./\u{1F680}.js'", "./🚀.js"),
            (r"'./\z.js'", "./z.js"),
        )
        statements = (
            "import {literal}", "import value from {literal}",
            "import {{ value as local }} from {literal}", "import * as api from {literal}",
            "import main, {{ value }} from {literal}", "import main, * as api from {literal}",
            "export {{ value as publicValue }} from {literal}", "export * from {literal}",
            "export * as api from {literal}", "const promise = import({literal})",
        )
        for literal, expected in literals:
            for statement in statements:
                with self.subTest(literal=literal, statement=statement):
                    source = statement.format(literal=literal) + ";"
                    imports, exports = parse_module(source)
                    dependencies = [item for item in (*imports, *exports) if item.spec]
                    self.assertEqual([item.spec for item in dependencies], [expected])
                    self.assertEqual(scan_import_paths(source), {expected})
                    for item in dependencies:
                        self.assertEqual(source[item.start:item.end], item.source)
                        self.assertIn(literal, item.source)

    def test_specifier_line_continuations_match_javascript_values(self):
        for newline in ("\n", "\r", "\r\n", "\u2028", "\u2029"):
            for template in ("import value from {literal};", "export * from {literal};", "const promise = import({literal});"):
                with self.subTest(newline=repr(newline), template=template):
                    literal = '"./de\\' + newline + 'p.js"'
                    source = template.format(literal=literal)
                    imports, exports = parse_module(source)
                    self.assertEqual([item.spec for item in (*imports, *exports) if item.spec], ["./dep.js"])
                    self.assertEqual(scan_import_paths(source), {"./dep.js"})

    def test_invalid_specifier_escapes_fail_both_dependency_readers(self):
        literals = (
            r"'./\x.js'", r"'./\xGG.js'", r"'./\u12.js'", r"'./\uZZZZ.js'",
            r"'./\u{}.js'", r"'./\u{xyz}.js'", r"'./\u{110000}.js'",
            r"'./\1.js'", r"'./\8.js'", r"'./\09.js'", "'./dep.js",
            "'./de\np.js'", "'./de\rp.js'",
        )
        for literal in literals:
            for template in ("import value from {literal};", "export * from {literal};", "const promise = import({literal});"):
                source = template.format(literal=literal)
                for reader in (parse_module, scan_import_paths):
                    with self.subTest(literal=literal, template=template, reader=reader.__name__):
                        with self.assertRaisesRegex(ParseError, "Malformed|Unterminated|Out-of-range"):
                            reader(source)

    def test_external_specifier_schemes_are_decoded_without_changing_identity(self):
        source = (
            r'import Value from "data\x3atext/javascript,export default 7";'
            r'const promise = import("https\u003a//example.invalid/module.js");'
        )
        expected = {"data:text/javascript,export default 7", "https://example.invalid/module.js"}
        imports, _ = parse_module(source)
        self.assertEqual({item.spec for item in imports}, expected)
        self.assertEqual(scan_import_paths(source), expected)


if __name__ == '__main__':
    unittest.main()
