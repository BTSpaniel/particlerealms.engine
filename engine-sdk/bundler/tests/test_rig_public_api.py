# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import re
import unittest
from pathlib import Path

from bundler.cli import _required_engine_public_module_paths
from bundler.graph import ModuleGraph
from bundler.parser import parse_module


ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP_PATH = ROOT / "engine/EngineBootstrap.js"
ENGINE_IMPORTS_PATH = ROOT / "engine/EngineImports.js"
RIG_BARREL_PATH = ROOT / "engine/assets/rig/index.js"
PLAYGROUND_RESOLVER_PATH = ROOT / "tests/playground/src/core/engine.js"


def _public_names(bindings):
    return {binding.rsplit(" as ", 1)[-1].strip() for binding in bindings}


class RigPublicApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bootstrap = BOOTSTRAP_PATH.read_text(encoding="utf-8")
        cls.engine_imports = ENGINE_IMPORTS_PATH.read_text(encoding="utf-8")
        cls.rig_barrel = RIG_BARREL_PATH.read_text(encoding="utf-8")

    def test_engine_bootstrap_exposes_rig_without_replacing_assets(self):
        imports, exports = parse_module(self.bootstrap)

        self.assertTrue(any(
            item.spec == "./assets/rig/index.js"
            and "Rig: _ParticleRig" in item.named
            for item in imports
        ))
        for public_name in ("particleRig", "Rig"):
            with self.subTest(public_name=public_name):
                self.assertTrue(any(
                    f"_ParticleRig as {public_name}" in item.named
                    for item in exports
                ))
        self.assertRegex(self.bootstrap, r"\bRig\s*:\s*_ParticleRig\b")

        self.assertTrue(any(
            item.namespace == "_ParticleAssets"
            and item.spec == "./assets/index.js"
            for item in imports
        ))
        for legacy_name in ("particleAssets", "Assets"):
            with self.subTest(legacy_name=legacy_name):
                self.assertTrue(any(
                    f"_ParticleAssets as {legacy_name}" in item.named
                    for item in exports
                ))

    def test_engine_imports_carries_the_same_rig_namespace(self):
        imports, exports = parse_module(self.engine_imports)

        self.assertTrue(any(
            item.spec == "./assets/rig/index.js" and "Rig" in _public_names(item.named)
            for item in imports
        ))
        self.assertTrue(any("Rig" in _public_names(item.named) for item in exports))

    def test_rig_barrel_contains_all_four_runtime_families(self):
        _, barrel_exports = parse_module(self.rig_barrel)
        contracts = (
            ("JointLimits", "./JointLimits.js", "buildJointLimits"),
            ("RagdollBuilder", "./RagdollBuilder.js", "buildRagdoll"),
            ("RagdollSim", "./RagdollSim.js", "createRagdollSim"),
            ("RagdollSkinning", "./RagdollSkinning.js", "buildSkinnedRagdoll"),
        )

        rig_declaration = self.rig_barrel[self.rig_barrel.index("export const Rig") :]
        for namespace, spec, representative_api in contracts:
            with self.subTest(namespace=namespace):
                matching_reexports = [
                    item for item in barrel_exports
                    if item.reexport and item.spec == spec and item.namespace is None
                ]
                self.assertTrue(matching_reexports)
                self.assertTrue(any(
                    not item.named or representative_api in _public_names(item.named)
                    for item in matching_reexports
                ))
                self.assertRegex(rig_declaration, rf"\b{re.escape(namespace)}\b")

                leaf = (RIG_BARREL_PATH.parent / spec).resolve()
                _, leaf_exports = parse_module(leaf.read_text(encoding="utf-8"))
                self.assertTrue(any(
                    representative_api in _public_names(item.named)
                    for item in leaf_exports
                ))

    def test_rig_barrel_is_in_the_release_bundler_graph(self):
        graph = ModuleGraph(ROOT)
        graph.walk("engine/assets/rig/index.js")
        module_ids = {graph.mod_id(path) for path in graph.modules}

        self.assertEqual(graph.errors, [])
        for module_id in (
            "engine/assets/rig/JointLimits.js",
            "engine/assets/rig/RagdollBuilder.js",
            "engine/assets/rig/RagdollSim.js",
            "engine/assets/rig/RagdollSkinning.js",
        ):
            with self.subTest(module_id=module_id):
                self.assertIn(module_id, module_ids)

    def test_release_contract_retains_the_rig_barrel_and_namespace_alias(self):
        resolver = PLAYGROUND_RESOLVER_PATH.read_text(encoding="utf-8")

        self.assertIn("engine/assets/rig/index.js", _required_engine_public_module_paths())
        self.assertIn("'assets/rig/index.js': 'particleRig'", resolver)


if __name__ == "__main__":
    unittest.main()
