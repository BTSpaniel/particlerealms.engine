# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Focused tests for final-bundle module registry extraction."""

import unittest

from bundler.parser import (
    ParseError,
    contains_code_token_sequence,
    contains_token_value_sequence,
    extract_canonical_module_registry,
)


def _bundle(registry_body: str, trailer: str = "") -> str:
    return (
        "(function(global){'use strict';var __modules={};"
        f"{registry_body}"
        "var PE={};"
        f"{trailer}"
        "PE.requireModule=function(id){return __r(id);};"
        "PE.__require=__r;PE.__modules=__modules;PE._require=PE.__require;"
        "})(typeof globalThis!=='undefined'?globalThis:this);"
    )


class TestCanonicalModuleRegistry(unittest.TestCase):
    def test_extracts_ordered_function_and_arrow_wrappers(self):
        source = _bundle(
            "__modules[0]=function(__e,__r){__e.alpha=1;};"
            "__modules[\"engine/tool.js\"]=(__e,__r)=>{__e.beta=2;};"
        )

        registry = extract_canonical_module_registry(source)

        self.assertEqual(registry.keys, (0, "engine/tool.js"))
        self.assertEqual(registry.wrappers[0].factory_kind, "function")
        self.assertEqual(registry.wrappers[1].factory_kind, "arrow")
        self.assertEqual(registry.wrappers[0].body(source), "__e.alpha=1;")
        self.assertTrue(registry.wrappers[0].has_export(source, "alpha"))
        self.assertFalse(registry.wrappers[0].has_export(source, "beta"))
        self.assertTrue(registry.has_outer_code_sequence(
            source,
            ("PE", ".", "__modules", "=", "__modules"),
        ))

    def test_ignores_comment_string_template_regex_and_nested_decoys(self):
        source = (
            "const before='var __modules={};__modules[80]=function(__e,__r){}';"
            "const pattern=/__modules\\[81\\]=function\\(__e,__r\\)\\{\\}/;"
            "const template=`__modules[82]=function(__e,__r){}`;"
            + _bundle(
                "__modules['entry.js']=function(__e,__r){"
                "const text='__e.spoof=1;__modules[83]=function(__e,__r){}';"
                "const template=`${__e.templateSpoof=1}`;"
                "const regex=/__e\\.regexSpoof=/;"
                "function nested(){__e.nestedSpoof=1;"
                "__modules[84]=function(__e,__r){__e.fake=1;};}"
                "__e.real=1;"
                "};"
            )
        )

        registry = extract_canonical_module_registry(source)
        wrapper = registry.wrapper_for("entry.js")

        self.assertEqual(registry.keys, ("entry.js",))
        self.assertTrue(wrapper.has_export(source, "real"))
        for symbol in ("spoof", "templateSpoof", "regexSpoof", "nestedSpoof", "fake"):
            self.assertFalse(wrapper.has_export(source, symbol))

    def test_extracts_direct_star_reexport_keys_only(self):
        source = _bundle(
            "__modules[0]=function(__e,__r){"
            "Object.assign(__e,__r(1));"
            "Object.assign(__e, __r('engine/public.js'));"
            "const fake='Object.assign(__e,__r(91))';"
            "function nested(){Object.assign(__e,__r(92));}"
            "};"
            "__modules[1]=function(__e,__r){__e.value=1;};"
            "__modules['engine/public.js']=function(__e,__r){__e.other=1;};"
        )

        registry = extract_canonical_module_registry(source)

        self.assertEqual(registry.wrapper_for(0).reexport_keys(source), (1, "engine/public.js"))
        self.assertEqual(registry.wrapper_for(1).reexport_keys(source), ())

    def test_outer_token_values_support_one_scan_marker_checks(self):
        source = _bundle(
            "__modules[0]=function(__e,__r){"
            "const fake='PE.__modules=wrong';"
            "};",
            trailer="const decoy=`PE.__modules=wrong`;",
        )
        registry = extract_canonical_module_registry(source)

        values = registry.outer_token_values(source)

        self.assertTrue(contains_token_value_sequence(
            values,
            ("PE", ".", "requireModule", "=", "function"),
        ))
        self.assertTrue(contains_token_value_sequence(
            values,
            ("PE", ".", "__modules", "=", "__modules"),
        ))
        self.assertFalse(contains_token_value_sequence(
            values,
            ("PE", ".", "__modules", "=", "wrong"),
        ))

    def test_code_sequence_helper_never_matches_literal_contents_or_nested_code(self):
        source = (
            "const string='PE.__modules=__modules';"
            "const template=`PE.__modules=__modules`;"
            "const regex=/PE\\.__modules=__modules/;"
            "function nested(){PE.__modules=__modules;}"
        )

        self.assertFalse(contains_code_token_sequence(
            source,
            ("PE", ".", "__modules", "=", "__modules"),
            brace_depth=0,
        ))

    def test_rejects_duplicate_runtime_property_keys(self):
        source = _bundle(
            "__modules[1]=function(__e,__r){};"
            "__modules['1']=(__e,__r)=>{};"
        )

        with self.assertRaisesRegex(ParseError, "Duplicate registry key"):
            extract_canonical_module_registry(source)

    def test_rejects_ambiguous_and_malformed_declarations(self):
        ambiguous = _bundle("__modules[0]=function(__e,__r){};") + _bundle(
            "__modules[1]=function(__e,__r){};"
        )
        malformed = "(function(){var __modules=[];})()"

        with self.assertRaisesRegex(ParseError, "Ambiguous canonical module registries"):
            extract_canonical_module_registry(ambiguous)
        with self.assertRaisesRegex(ParseError, "Malformed outer-IIFE"):
            extract_canonical_module_registry(malformed)

    def test_rejects_malformed_direct_wrapper_factory(self):
        source = _bundle("__modules[0]=function(exports,require){};")

        with self.assertRaisesRegex(ParseError, "Non-canonical registry factory"):
            extract_canonical_module_registry(source)


if __name__ == "__main__":
    unittest.main()
