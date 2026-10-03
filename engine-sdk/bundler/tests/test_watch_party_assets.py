# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Verify independent guest realms, byte preservation and missing-module failure."""
import json
from pathlib import Path
import tempfile
import unittest

from bundler.site import (lay_down_watch_party_runtime_assets, validate_watch_party_deployment,
                          watch_party_runtime_asset_manifest, hls_runtime_asset_manifest)
from bundler.site_compaction import compact_release_site, verify_site_archives

ROOT = Path(__file__).resolve().parents[2]


class WatchPartyAssetsTests(unittest.TestCase):
    def test_compact_release_preserves_cold_guest_and_worker_realms(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'full'
            output = Path(temporary) / 'compact'
            lay_down_watch_party_runtime_assets(ROOT, source)
            # Enough independent small resources to exercise real archive selection.
            for index in range(1000):
                path = source / f'plauna/extra/{index}.js'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(f'export const value = {index};', encoding='utf-8')
            compact_release_site(ROOT, source, output, max_files=400)
            archived = verify_site_archives(output)
            self.assertIn('plauna/extra/999.js', archived)
            for _source, destination in watch_party_runtime_asset_manifest(ROOT):
                self.assertNotIn(destination, archived)
                self.assertEqual((source / destination).read_bytes(), (output / destination).read_bytes())
            self.assertGreater(validate_watch_party_deployment(output), 15)

    def test_guest_and_workers_ship_their_transitive_modules(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            count = lay_down_watch_party_runtime_assets(ROOT, site)
            self.assertGreater(count, 15)
            self.assertGreater(validate_watch_party_deployment(site), 15)
            for path in site.rglob("*"):
                if path.is_file():
                    self.assertEqual(path.read_bytes(), (ROOT / path.relative_to(site)).read_bytes())
            self.assertFalse((site / "webgpu-os/kernel/Syscalls.js").exists())
            self.assertFalse((site / "webgpu-os/boot.js").exists())
            (site / "engine/media/codecs/Binary.js").unlink()
            with self.assertRaises((FileNotFoundError, RuntimeError, ValueError)):
                validate_watch_party_deployment(site)

    def test_missing_worker_and_hls_asset_fail_before_publish(self):
        for name in ("engine/media/codecs/CodecWorker.js", "vendor/hls.js/hls.worker.js"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                site = Path(temporary)
                lay_down_watch_party_runtime_assets(ROOT, site)
                (site / name).unlink()
                with self.assertRaises(FileNotFoundError):
                    validate_watch_party_deployment(site)

    def test_hls_distribution_matches_pinned_file_hashes(self):
        provenance = json.loads((ROOT / "vendor/hls.js/provenance.json").read_text())
        self.assertEqual(provenance["version"], "1.7.3")
        manifest = dict(hls_runtime_asset_manifest(ROOT))
        self.assertEqual(set(manifest), {"vendor/hls.js/provenance.json"} |
                         {"vendor/hls.js/" + record["path"] for record in provenance["files"]})


if __name__ == "__main__":
    unittest.main()
