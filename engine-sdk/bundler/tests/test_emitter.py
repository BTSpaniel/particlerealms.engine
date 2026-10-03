# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Tests for bundler.emitter."""

import unittest
from urllib.parse import urljoin

from bundler.emitter import (
    assert_classic_script_compatible,
    find_executable_import_meta,
    rewrite_module_canonical,
)
from bundler.builder import minify_source
from bundler.parser import ParseError


class _SimpleGraph:
    def __init__(self, base):
        self.base = base
        self.ids = {}

    def resolve_import(self, filepath, imp_path, os_base_prefix=None):
        if imp_path.startswith("./"):
            return self.base + "/" + imp_path[2:]
        return imp_path

    def mod_id(self, resolved):
        return resolved


class TestEmitter(unittest.TestCase):
    def _graph(self, base="src"):
        return _SimpleGraph(base)

    def test_default_import(self):
        source = "import foo from './bar.js';\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("const foo = (__r('src/bar.js').__default || __r('src/bar.js'));", out)

    def test_named_import(self):
        source = "import { a, b } from './baz.js';\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("const { a, b } = __r('src/baz.js');", out)

    def test_side_effect_import(self):
        source = "import './side.js';\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("__r('src/side.js');", out)

    def test_namespace_import(self):
        source = "import * as lib from './lib.js';\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("const lib = __r('src/lib.js');", out)

    def test_export_named(self):
        source = "export { a, b };\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("__e.a = a; __e.b = b;", out)

    def test_named_export_preserves_boundary_after_default_class_expression(self):
        source = (
            "const value = 1;\n"
            "export default class Demo {}\n"
            "export { value };\n"
        )
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("\n;__e.value = value;", out)
        minified = minify_source(out)
        self.assertNotRegex(minified, r"class Demo\{\}\s+__e\.value")
        self.assertRegex(minified, r"class Demo\{\}\s*;+__e\.value=value;")

    def test_default_declarations_preserve_boundary_before_ordinary_code(self):
        cases = (
            (
                "class with nested syntax",
                "export default class Demo extends mixin({ key: '}' }) {\n"
                "  method({ value = `raw } ${1}` } = {}) { return /}/.test(value); }\n"
                "}\nfunction esc(value) { return value; }\n",
                r"}\s*;function esc\(",
            ),
            (
                "anonymous generator",
                "export default function* () { yield { value: 1 }; }\n"
                "const after = true;\n",
                r"}\s*;const after=",
            ),
            (
                "async function",
                "export default async function load() { return {}; }\n"
                "function after() {}\n",
                r"}\s*;function after\(",
            ),
        )
        for label, source, boundary in cases:
            with self.subTest(label=label):
                out = rewrite_module_canonical(source, "src/index.js", self._graph())
                minified = minify_source(out)
                self.assertRegex(minified, boundary)
                self.assertNotRegex(minified, r"}\s+(?:function|const)\b")
                if "Demo" in source:
                    self.assertIn("class Demo", out)
                    self.assertNotIn("__e.__default = class Demo", out)
                    self.assertRegex(minified, r";__e\.__default=Demo;")
                elif "load" in source:
                    self.assertIn("async function load", out)
                    self.assertNotIn("__e.__default = async function load", out)
                    self.assertRegex(minified, r";__e\.__default=load;")

    def test_export_default(self):
        source = "export default function() {}\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("__e.__default = function() {}", out)

    def test_export_declaration_preserves_declaration(self):
        source = "export const value = 42;\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("const value = 42;", out)
        self.assertIn("__e.value = value;", out)

    def test_exported_generators_preserve_declarations_and_iterator_bodies(self):
        for declaration in ("function*", "function *", "async function*", "async function *"):
            with self.subTest(declaration=declaration):
                first_yield = "yield await Promise.resolve(1);" if declaration.startswith("async") else "yield 1;"
                source = (
                    "const before = sequence;\n"
                    f"export {declaration} sequence() {{\n"
                    f"  try {{ {first_yield} yield* [2, 3]; }} finally {{ cleanup(); }}\n"
                    "}\nconst after = sequence;\n"
                )
                out = rewrite_module_canonical(source, "src/index.js", self._graph())
                self.assertEqual(out, source.replace("export", "", 1) + "\n;__e.sequence = sequence;")
                assert_classic_script_compatible(out, "exported-generator.js")

    def test_export_destructuring_assigns_every_declared_binding(self):
        source = "export const { direct, key: local, nested: { deep }, ...rest } = value;\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("const { direct, key: local, nested: { deep }, ...rest } = value;", out)
        self.assertIn(
            "__e.direct = direct; __e.local = local; __e.deep = deep; __e.rest = rest;",
            out,
        )
        self.assertNotIn("__e.{", out)

    def test_export_variable_declaration_list_assigns_all_public_bindings(self):
        source = (
            "const version = 1;\n"
            "export const FORMAT = 'particle-realms.realm-storylet-catalog',\n"
            "  VERSION = version, MAJOR_VERSION = version,\n"
            "  { key: local } = { key: [1, 2] };\n"
        )
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        assignments = "__e.FORMAT = FORMAT; __e.VERSION = VERSION; __e.MAJOR_VERSION = MAJOR_VERSION; __e.local = local;"
        self.assertEqual(out, source.replace("export", "", 1) + "\n;" + assignments)
        assert_classic_script_compatible(minify_source(out), "declaration-list.js")

    def test_aliases_and_multiple_statement_offsets(self):
        source = "const before = true;\nimport { a as local } from './mod.js';\nexport { local as publicName };\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        self.assertIn("const before = true;", out)
        self.assertIn("const { a: local } = __r('src/mod.js');", out)
        self.assertIn("__e.publicName = local;", out)

    def test_import_meta_is_rewritten_for_classic_script(self):
        source = "const url = import.meta.url; const meta = import.meta;\n"
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        expected_url = "(document.currentScript&&document.currentScript.src||document.baseURI||'')"
        self.assertNotIn("import.meta", out)
        self.assertIn(f"const url = {expected_url};", out)
        self.assertIn(f"const meta = ({{url:{expected_url}}});", out)
        assert_classic_script_compatible(out, "unit-test.js")

    def test_import_meta_preserves_original_webgpu_os_module_path(self):
        source = "const indexUrl = new URL('../apps/index.json', import.meta.url).href;\n"
        out = rewrite_module_canonical(
            source,
            "webgpu-os/kernel/AppRegistry.js",
            self._graph(),
            os_base_prefix="webgpu-os/",
        )
        expected = (
            "new URL(\"kernel/AppRegistry.js\","
            "(globalThis.__PE_OS_BASE__||document.baseURI||'')).href"
        )
        self.assertNotIn("import.meta", out)
        self.assertIn(expected, out)

    def test_particle_voice_worklet_url_survives_compiled_os_registry(self):
        relative = '../../../../agi/particle_voice/worklet/ParticleVoiceProcessor.js'
        source = f"export const worklet = new URL('{relative}', import.meta.url).href;\n"
        out = rewrite_module_canonical(
            source, "webgpu-os/kernel/navi/voice/ParticleVoiceOutput.js", self._graph(),
            os_base_prefix="webgpu-os/",
        )
        self.assertIn(
            'new URL("kernel/navi/voice/ParticleVoiceOutput.js",'
            "(globalThis.__PE_OS_BASE__||document.baseURI||'')).href", out,
        )
        self.assertIn(f"new URL('{relative}',", out)
        self.assertEqual(find_executable_import_meta(out), [])
        assert_classic_script_compatible(out, "particle-voice-output.js")
        for prefix in ('/', '/releases/example/'):
            site = f'https://example.test{prefix}'
            source_url = urljoin(site, 'webgpu-os/kernel/navi/voice/ParticleVoiceOutput.js')
            self.assertEqual(urljoin(source_url, relative), urljoin(site, relative[12:]))

    def test_ocr_worker_url_survives_playground_compiled_os_registry(self):
        source = "export const worker = new URL('./worker.js', import.meta.url).href;\n"
        out = rewrite_module_canonical(
            source, "webgpu-os/factory/components/ocr/worker-client.js", self._graph(),
            os_base_prefix="webgpu-os/",
        )
        self.assertIn(
            'new URL("factory/components/ocr/worker-client.js",'
            "(globalThis.__PE_OS_BASE__||document.baseURI||'')).href", out,
        )
        self.assertEqual(find_executable_import_meta(out), [])
        assert_classic_script_compatible(out, "ocr-worker-client.js")
        for prefix in ('/', '/releases/example/'):
            site = f'https://example.test{prefix}'
            os_base = urljoin(urljoin(site, 'playground/'), '../webgpu-os/')
            source_url = urljoin(os_base, 'factory/components/ocr/worker-client.js')
            self.assertEqual(
                urljoin(source_url, './worker.js'),
                urljoin(site, 'webgpu-os/factory/components/ocr/worker.js'),
            )

    def test_import_meta_preserves_non_os_runtime_module_paths(self):
        cases = (
            ("engine/render/MaterialLoader.js", "engine", "__PE_ENGINE_BASE__", "/engine/", "render/MaterialLoader.js"),
            ("editor/js/Profiler.js", "editor", "__PE_EDITOR_BASE__", "/editor/", "js/Profiler.js"),
            ("plauna/widgets/ThemeLoader.js", "plauna", "__PE_PLAUNA_BASE__", "/plauna/", "widgets/ThemeLoader.js"),
            ("agi/llm/Tokenizer.js", "agi", "__PE_AGI_BASE__", "/agi/", "llm/Tokenizer.js"),
        )
        source = "const resource = new URL('./sidecar.json', import.meta.url).href;\n"
        for filepath, key, legacy_global, default_path, relative_path in cases:
            with self.subTest(filepath=filepath):
                out = rewrite_module_canonical(source, filepath, self._graph())
                self.assertNotIn("import.meta", out)
                self.assertIn(f'new URL("{relative_path}",', out)
                self.assertIn(f"globalThis.{legacy_global}", out)
                self.assertIn(f'["{key}"]', out)
                self.assertIn(f'new URL("{default_path}",document.baseURI).href', out)
                self.assertEqual(find_executable_import_meta(out), [])

    def test_import_meta_scanner_preserves_literals_and_rewrites_template_expressions(self):
        source = "\n".join([
            "const stringValue = 'import.meta.url';",
            "const pattern = /import\\.meta\\.url/;",
            "// import.meta.url",
            "const raw = `import.meta.url ${import.meta.url}`;",
            "const property = object.import.meta.url;",
        ])
        out = rewrite_module_canonical(source, "src/index.js", self._graph())
        expected_url = "(document.currentScript&&document.currentScript.src||document.baseURI||'')"
        self.assertIn("'import.meta.url'", out)
        self.assertIn(r"/import\.meta\.url/", out)
        self.assertIn("// import.meta.url", out)
        self.assertIn(f"`import.meta.url ${{{expected_url}}}`", out)
        self.assertIn("object.import.meta.url", out)
        self.assertEqual(find_executable_import_meta(out), [])

    def test_classic_script_gate_reports_executable_import_meta(self):
        with self.assertRaisesRegex(ParseError, r"broken\.js contains 1 executable import\.meta"):
            assert_classic_script_compatible("const url = import.meta.url;", "broken.js")


if __name__ == '__main__':
    unittest.main()
