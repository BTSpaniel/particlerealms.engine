# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""The installed-app graph must reach the same owned OCR and reading surface."""

import unittest
from pathlib import Path

from bundler.graph import ModuleGraph

ROOT = Path(__file__).resolve().parents[2]


class SharedOcrGraphTests(unittest.TestCase):
    def test_original_consumers_resolve_the_same_source_implementation(self):
        shared = {
            "webgpu-os/factory/components/ocr/index.js",
            "webgpu-os/factory/components/ocr/directions.js",
            "webgpu-os/factory/components/ocr/execution.js",
            "webgpu-os/factory/components/ocr/scan-surface.js",
            "webgpu-os/factory/components/drawing/viewport.js",
            "engine/core/math/DocumentDirectionMath.js",
            "agi/vision/GlyphRecognizer.js",
        }
        for entry in (
            "webgpu-os/factory/apps/notepad/NotepadApp.js",
            "webgpu-os/factory/apps/sewing/SewingApp.js",
            "webgpu-os/apps/ai-echo/factory.js",
        ):
            with self.subTest(entry=entry):
                graph = ModuleGraph(ROOT)
                graph.walk(entry)
                self.assertEqual(graph.errors, [])
                modules = {graph.mod_id(path) for path in graph.modules}
                self.assertFalse(shared - modules, f"{entry} lost shared modules: {shared - modules}")


if __name__ == "__main__":
    unittest.main()
