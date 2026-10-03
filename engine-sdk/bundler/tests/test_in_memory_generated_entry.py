# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import tempfile
import unittest
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bundler.graph import ModuleGraph
from bundler.site import WEBGPU_OS_BARREL_REL, render_webgpu_os_app_barrel


class TestInMemoryGeneratedEntry(unittest.TestCase):
    def _fixture(self, root):
        app_dir = root / "webgpu-os" / "apps" / "demo"
        app_dir.mkdir(parents=True)
        (root / "webgpu-os" / "mods").mkdir()
        (root / "webgpu-os" / "apps" / "index.json").write_text(
            '["demo"]', encoding="utf-8"
        )
        (root / "webgpu-os" / "mods" / "index.json").write_text(
            '[]', encoding="utf-8"
        )
        (app_dir / "manifest.json").write_text(
            '{"appId":"os.demo","entry":"./factory.js"}', encoding="utf-8"
        )
        (app_dir / "factory.js").write_text(
            "export const create = () => 'demo';\n", encoding="utf-8"
        )

    def test_barrel_is_rendered_without_shared_temporary_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)

            source = render_webgpu_os_app_barrel(root)

            self.assertIn('load: () => import("./apps/demo/factory.js")', source)
            self.assertNotIn("import * as __os_app_", source)
            self.assertIn("globalThis.__OS_BUNDLED_APPS_COMPLETE__ = true;", source)
            self.assertFalse((root / WEBGPU_OS_BARREL_REL).exists())

    def test_app_entry_is_in_graph_without_eager_barrel_require(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            source = render_webgpu_os_app_barrel(root)
            graph = ModuleGraph(root)

            graph.walk_source(WEBGPU_OS_BARREL_REL, source)

            self.assertIn(
                "webgpu-os/apps/demo/factory.js",
                {graph.mod_id(path) for path in graph.modules},
            )
            self.assertIn('load: () => import("./apps/demo/factory.js")', source)
            self.assertNotIn("module: __os_app_", source)

    def test_missing_or_malformed_indexes_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            (root / "webgpu-os" / "mods" / "index.json").unlink()
            with self.assertRaisesRegex(FileNotFoundError, "mods index"):
                render_webgpu_os_app_barrel(root)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            (root / "webgpu-os" / "apps" / "index.json").write_text("{", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Invalid WebGPU OS apps index JSON"):
                render_webgpu_os_app_barrel(root)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            (root / "webgpu-os" / "apps" / "index.json").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must be a JSON array"):
                render_webgpu_os_app_barrel(root)

    def test_duplicate_index_entries_and_unindexed_manifests_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            (root / "webgpu-os" / "apps" / "index.json").write_text(
                '["demo", "demo"]', encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "repeats folder"):
                render_webgpu_os_app_barrel(root)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            unindexed = root / "webgpu-os" / "apps" / "hidden"
            unindexed.mkdir()
            (unindexed / "manifest.json").write_text(
                '{"appId":"os.hidden","entry":"./factory.js"}', encoding="utf-8"
            )
            (unindexed / "factory.js").write_text("export {};", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "unindexed=.*hidden"):
                render_webgpu_os_app_barrel(root)

    def test_manifest_errors_duplicate_ids_and_stale_entries_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            manifest = root / "webgpu-os" / "apps" / "demo" / "manifest.json"
            manifest.write_text("{", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Invalid WebGPU OS apps/demo manifest JSON"):
                render_webgpu_os_app_barrel(root)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            manifest = root / "webgpu-os" / "apps" / "demo" / "manifest.json"
            manifest.write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "manifest must be an object"):
                render_webgpu_os_app_barrel(root)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            second = root / "webgpu-os" / "apps" / "second"
            second.mkdir()
            (second / "manifest.json").write_text(
                '{"appId":"os.demo","entry":"./factory.js"}', encoding="utf-8"
            )
            (second / "factory.js").write_text("export {};", encoding="utf-8")
            (root / "webgpu-os" / "apps" / "index.json").write_text(
                '["demo", "second"]', encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "duplicate appId"):
                render_webgpu_os_app_barrel(root)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            manifest = root / "webgpu-os" / "apps" / "demo" / "manifest.json"
            document = json.loads(manifest.read_text(encoding="utf-8"))
            document["entry"] = "./missing.js"
            manifest.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(FileNotFoundError, "entry is stale"):
                render_webgpu_os_app_barrel(root)

    def test_concurrent_graphs_walk_same_stable_virtual_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._fixture(root)
            source = render_webgpu_os_app_barrel(root)

            def walk_graph(_):
                graph = ModuleGraph(root)
                graph.walk_source(WEBGPU_OS_BARREL_REL, source)
                return graph

            with ThreadPoolExecutor(max_workers=8) as executor:
                graphs = list(executor.map(walk_graph, range(16)))

            for graph in graphs:
                self.assertEqual(graph.errors, [])
                self.assertIn(WEBGPU_OS_BARREL_REL, {
                    graph.mod_id(path) for path in graph.modules
                })
                self.assertIn("webgpu-os/apps/demo/factory.js", {
                    graph.mod_id(path) for path in graph.modules
                })
            self.assertFalse((root / WEBGPU_OS_BARREL_REL).exists())


if __name__ == "__main__":
    unittest.main()
