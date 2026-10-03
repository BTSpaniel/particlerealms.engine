# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import json
import tempfile
import unittest
from pathlib import Path

from bundler.code_metrics import collect_code_metrics, physical_line_count, write_code_metrics


class TestCodeMetrics(unittest.TestCase):
    def test_counts_first_party_physical_lines_and_excludes_generated_vendor_code(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures = {
                "engine/render/Renderer.js": b"one\ntwo\nthree\n",
                "editor/js/main.js": b"one\r\ntwo",
                "plauna/index.js": b"single",
                "agi/tensor.wgsl": b"",
                "webgpu-os/apps/demo/index.html": b"a\nb\n",
                "engine/vendor/library.js": b"ignored\nignored\n",
                "engine/kaolin/foreign.py": b"ignored\n",
                "engine/sim/physics/physx.js": b"ignored\n",
                "engine/render/cache.generated.js": b"ignored\n",
                "webgpu-os/app.min.js": b"ignored\n",
                "webgpu-os/.logs/evidence/bundle/particle-os.js": b"ignored\n",
                "docs/outside.js": b"ignored\n",
            }
            for name, data in fixtures.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)

            metrics = collect_code_metrics(root, "2026-07-17T00:00:00Z")

            self.assertEqual(metrics["totals"], {"files": 5, "lines": 8})
            self.assertEqual(metrics["roots"]["engine"]["lines"], 3)
            self.assertEqual(metrics["roots"]["editor"]["lines"], 2)
            self.assertEqual(metrics["roots"]["agi"]["lines"], 0)
            self.assertEqual(metrics["generated_at"], "2026-07-17T00:00:00Z")
            rendering = next(item for item in metrics["categories"] if item["id"] == "rendering")
            self.assertEqual(rendering["files"], 1)
            os_apps = next(item for item in metrics["categories"] if item["id"] == "os-apps")
            self.assertEqual(os_apps["lines"], 2)

    def test_line_count_and_json_writer_are_exact(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.js"
            source.write_bytes(b"alpha\nbeta")
            self.assertEqual(physical_line_count(source), 2)
            source.write_bytes(b"")
            self.assertEqual(physical_line_count(source), 0)

            output = root / "nested" / "metrics.json"
            write_code_metrics(output, {"schema": "test", "totals": {"files": 0, "lines": 0}})
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["schema"], "test")
            self.assertTrue(output.read_text(encoding="utf-8").endswith("\n"))


if __name__ == "__main__":
    unittest.main()
