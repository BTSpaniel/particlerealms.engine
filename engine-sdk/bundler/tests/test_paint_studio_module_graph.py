# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Guard the cycle-free Paint recipe renderer and its compatibility export."""

import unittest
from pathlib import Path

from bundler.graph import ModuleGraph
from bundler.parser import parse_module


ROOT = Path(__file__).resolve().parents[2]
PANELS = "webgpu-os/factory/apps/paint/panels/"


class PaintStudioModuleGraphTests(unittest.TestCase):
    def test_dialog_and_layer_effects_close_without_cycle_exemptions(self):
        for entry in ("studio/studioDialog.js", "layers/layerEffects.js"):
            with self.subTest(entry=entry):
                graph = ModuleGraph(ROOT, cyclic_baseline=[])
                graph.walk(PANELS + entry)
                self.assertEqual(graph.errors, [])
                self.assertEqual(graph.cycles, [])
                modules = {graph.mod_id(path) for path in graph.modules}
                self.assertIn(PANELS + "studio/filterStudio.js", modules)
                self.assertIn(PANELS + "shared/panelFields.js", modules)

    def test_recipe_renderer_does_not_pull_its_dialog_or_inspector(self):
        graph = ModuleGraph(ROOT, cyclic_baseline=[])
        graph.walk(PANELS + "studio/filterStudio.js")
        self.assertEqual(graph.errors, [])
        modules = {graph.mod_id(path) for path in graph.modules}
        self.assertNotIn(PANELS + "studio/studioDialog.js", modules)
        self.assertNotIn(PANELS + "layers/layerEffects.js", modules)
        self.assertIn(
            "webgpu-os/factory/apps/paint/filters/studio/filterStackModel.js", modules
        )

    def test_original_public_export_points_at_the_single_renderer(self):
        source = (ROOT / (PANELS + "studio/studioDialog.js")).read_text(encoding="utf-8")
        _, exports = parse_module(source)
        self.assertTrue(any(
            item.reexport and item.spec == "./filterStudio.js"
            and "filterStudio" in item.named for item in exports
        ))
        self.assertNotIn("function filterStudio(", source)
        effects = (ROOT / (PANELS + "layers/layerEffects.js")).read_text(encoding="utf-8")
        imports, _ = parse_module(effects)
        self.assertTrue(any(item.spec == "../studio/filterStudio.js" for item in imports))
        self.assertFalse(any(item.spec == "../studio/studioDialog.js" for item in imports))


if __name__ == "__main__":
    unittest.main()
