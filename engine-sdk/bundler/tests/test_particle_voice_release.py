# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""The deployed voice lab and AudioWorklet must not depend on the source tree."""

import shutil
import tempfile
import unittest
from pathlib import Path

from bundler.site import (
    PARTICLE_VOICE_LAB_PATH,
    PARTICLE_VOICE_WORKLET_PATH,
    particle_voice_release_asset_paths,
    release_site_sidecar_asset_manifest,
)
from bundler.cli import _release_build_input_digest


ROOT = Path(__file__).resolve().parents[2]


class TestParticleVoiceRelease(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.paths = particle_voice_release_asset_paths(ROOT)

    def _copy_closure(self, site):
        for relative in self.paths:
            destination = site / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)

    def test_manifest_contains_exact_dependency_closure_without_duplicate_destinations(self):
        manifest = release_site_sidecar_asset_manifest(ROOT)
        self.assertEqual(len(manifest), len({destination for _, destination in manifest}))
        destinations = {destination for _, destination in manifest}
        self.assertTrue(set(self.paths).issubset(destinations))
        required = {
            PARTICLE_VOICE_LAB_PATH, PARTICLE_VOICE_WORKLET_PATH,
            'agi/particle_voice/lab/voice-lab.css',
            'agi/particle_voice/model/ParticleVoiceModel.js',
            'agi/particle_voice/lab/ManualArticulator.js',
            'agi/particle_voice/lab/VoiceLabDiagnostics.js',
            'agi/particle_voice/lab/VoiceLabTuning.js',
            'agi/particle_voice/lab/ListeningEvaluation.js',
            'agi/particle_voice/lab/ListeningPracticeCorpus.js',
            'agi/particle_voice/risk/ReceiptCrypto.js',
            'agi/particle_voice/frontend/PronunciationOverrides.js',
            'agi/particle_voice/streaming/SharedPCMRing.js',
            'agi/particle_voice/nn/kernels/articulatory/tract_waveguide.js',
            'engine/core/gpu/GpuDevice.js',
        }
        self.assertTrue(required.issubset(self.paths))
        self.assertFalse(any('/tests/' in path or path.endswith('.md') for path in self.paths))

    def test_standalone_site_closure_resolves_without_repository_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / 'site'
            self._copy_closure(site)
            self.assertEqual(particle_voice_release_asset_paths(site), self.paths)
            for relative in self.paths:
                self.assertEqual((site / relative).read_bytes(), (ROOT / relative).read_bytes())

    def test_site_cache_tracks_raw_lab_worklet_and_transitive_imports(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / 'site'
            self._copy_closure(site)
            runtime_digest = _release_build_input_digest(site, include_site=False)
            previous = _release_build_input_digest(site, include_site=True)
            for relative in (
                PARTICLE_VOICE_LAB_PATH, PARTICLE_VOICE_WORKLET_PATH,
                'agi/particle_voice/lab/ListeningEvaluation.js',
                'agi/particle_voice/lab/ListeningPracticeCorpus.js',
                'agi/particle_voice/lab/voice-lab.css',
                'agi/particle_voice/risk/ReceiptCrypto.js',
            ):
                with self.subTest(relative=relative):
                    path = site / relative
                    source = path.read_text(encoding='utf-8')
                    suffix = {
                        '.html': '\n<!-- release input revision -->\n',
                        '.css': '\n/* release input revision */\n',
                    }.get(path.suffix, '\n// release input revision\n')
                    path.write_text(source + suffix, encoding='utf-8')
                    current = _release_build_input_digest(site, include_site=True)
                    self.assertNotEqual(previous, current)
                    self.assertEqual(runtime_digest, _release_build_input_digest(site, include_site=False))
                    previous = current

    def test_missing_lab_stylesheet_fails_release_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / 'site'
            self._copy_closure(site)
            stylesheet = site / 'agi/particle_voice/lab/voice-lab.css'
            stylesheet.unlink()
            with self.assertRaisesRegex(FileNotFoundError, 'Particle Voice release stylesheet is missing'):
                particle_voice_release_asset_paths(site)

    def test_missing_worklet_and_transitive_solver_fail_release_validation(self):
        for missing in (
            PARTICLE_VOICE_WORKLET_PATH,
            'agi/particle_voice/nn/kernels/articulatory/tract_waveguide.js',
        ):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as temporary:
                site = Path(temporary) / 'site'
                self._copy_closure(site)
                (site / missing).unlink()
                with self.assertRaisesRegex(RuntimeError, 'Particle Voice release dependency graph is incomplete'):
                    particle_voice_release_asset_paths(site)

    def test_external_worklet_dependency_is_rejected_instead_of_silently_omitted(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / 'site'
            self._copy_closure(site)
            worklet = site / PARTICLE_VOICE_WORKLET_PATH
            worklet.write_text("import 'https://example.test/processor.js';\n", encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Particle Voice release dependency is not local'):
                particle_voice_release_asset_paths(site)

    def test_changed_lab_entry_contract_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / 'site'
            self._copy_closure(site)
            lab = site / PARTICLE_VOICE_LAB_PATH
            lab.write_text('<script type="module" src="./not-copied.js"></script>', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'exactly one inline module entry'):
                particle_voice_release_asset_paths(site)


if __name__ == '__main__':
    unittest.main()
