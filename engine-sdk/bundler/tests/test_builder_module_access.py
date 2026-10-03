# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import unittest

from bundler.builder import (
    build_bundle,
    public_entry_namespace,
    shorten_bundle_internals,
    shorten_module_ids,
)
from bundler.emitter import assert_classic_script_compatible


class _ModuleAccessGraph:
    def __init__(self):
        self.order = ["engine/main.js", "webgpu-os/tool.js"]
        self.modules = {
            "engine/main.js": "export const engineValue = 7;\n",
            "webgpu-os/tool.js": "export const osValue = 9;\n",
        }
        self.stats = {
            "files": len(self.order),
            "total_bytes": sum(len(source.encode("utf-8")) for source in self.modules.values()),
        }

    @staticmethod
    def mod_id(filepath):
        return str(filepath).replace("\\", "/")


class TestBuilderModuleAccess(unittest.TestCase):
    def test_platform_entries_receive_distinct_stable_namespaces(self):
        expected = {
            "agi/index.js": "AGI",
            "plauna/index.js": "Plauna",
            "webgpu-os/index.js": "WebGPUOS",
            "webgpu-os/.bundled-os-content.generated.js": "WebGPUOSContent",
        }
        self.assertEqual(
            {entry: public_entry_namespace(entry) for entry in expected},
            expected,
        )

        graph = _ModuleAccessGraph()
        for entry in expected:
            graph.order.append(entry)
            graph.modules[entry] = "export const marker = true;\n"
        source = build_bundle(
            graph,
            ".",
            entry_ids=["engine/main.js", *expected],
        )
        for namespace in expected.values():
            self.assertIn(f"PE.{namespace} = __{namespace};", source)
        self.assertNotIn("PE.index =", source)

    def test_original_path_resolver_survives_id_shortening_without_literal_rewrites(self):
        graph = _ModuleAccessGraph()
        graph.modules["engine/main.js"] = (
            "export const engineValue = 7;\n"
            "export const provenance = { uri: 'engine/main.js' };\n"
            "export const requireText = \"__r('engine/main.js')\";\n"
            "export const registryText = \"__modules['engine/main.js']\";\n"
            "export const templateText = `__r('engine/main.js')`;\n"
            "export const regexText = /__r\\('engine\\/main\\.js'\\)/;\n"
            "export const memberCall = target.__r('engine/main.js');\n"
            "export const optionalMemberCall = target?.__r('engine/main.js');\n"
            "// __r('engine/main.js') must remain comment text.\n"
        )
        source = build_bundle(graph, ".", entry_ids=["engine/main.js"])

        compacted, id_map = shorten_module_ids(source)
        optimized = shorten_bundle_internals(compacted)

        self.assertEqual(id_map["engine/main.js"], "0")
        self.assertIn('"engine/main.js":0', optimized)
        self.assertIn("__modules[0]", optimized)
        self.assertIn("__r(0)", optimized)
        self.assertIn("uri: 'engine/main.js'", optimized)
        self.assertNotIn("uri: 0", optimized)
        self.assertIn("\"__r('engine/main.js')\"", optimized)
        self.assertIn("\"__modules['engine/main.js']\"", optimized)
        self.assertIn("`__r('engine/main.js')`", optimized)
        self.assertIn("/__r\\('engine\\/main\\.js'\\)/", optimized)
        self.assertIn("target.__r('engine/main.js')", optimized)
        self.assertIn("target?.__r('engine/main.js')", optimized)
        self.assertIn("// __r('engine/main.js') must remain comment text.", optimized)
        self.assertIn("__modules['webgpu-os/tool.js']", optimized)
        self.assertIn("PE.requireModule = function(id)", optimized)
        self.assertIn("var moduleId = __resolveModuleId(id);", optimized)
        self.assertIn("return __r(moduleId);", optimized)

        # Both the original public names and the compact production aliases are
        # retained so existing consumers remain compatible.
        self.assertIn("PE.__require = __r;", optimized)
        self.assertIn("PE.__modules = __modules;", optimized)
        self.assertIn("PE.__cache   = __cache;", optimized)
        self.assertIn("PE._require = __r;", optimized)
        self.assertIn("PE._M = __modules;", optimized)
        self.assertIn("PE._C = __cache;", optimized)
        assert_classic_script_compatible(optimized, "module-access.js")

    def test_forward_require_compacts_without_rewriting_member_calls(self):
        source = (
            "var __moduleIdMap = Object.freeze({});\n"
            "const forward = __r('engine/forward.js');\n"
            "const member = target.__r('engine/forward.js');\n"
            "const optionalMember = target?.__r('engine/forward.js');\n"
            "__modules['engine/forward.js'] = function(__e, __r) {};\n"
        )

        compacted, id_map = shorten_module_ids(source)

        self.assertEqual(id_map, {"engine/forward.js": "0"})
        self.assertIn('var __moduleIdMap = Object.freeze({"engine/forward.js":0});', compacted)
        self.assertIn("const forward = __r(0);", compacted)
        self.assertIn("__modules[0] = function(__e, __r)", compacted)
        self.assertIn("target.__r('engine/forward.js')", compacted)
        self.assertIn("target?.__r('engine/forward.js')", compacted)
        assert_classic_script_compatible(compacted, "forward-module-access.js")

    def test_internal_compaction_never_rewrites_signed_or_application_text(self):
        source = (
            'globalThis.__OS_OFFICIAL_PACKAGES__={'
            '"signature":"x6Stn37IYKKEERwa2NmgKAUmhN56074Hm8M3bQsyPTCyOa0FxNR__rrw"};'
            'const labels=["__r","__e","__modules","__cache","__esModule"];'
            'var __modules={};var __cache={};function __r(){};function f(__e,__r){};'
        )
        self.assertEqual(shorten_bundle_internals(source), source)


if __name__ == "__main__":
    unittest.main()
