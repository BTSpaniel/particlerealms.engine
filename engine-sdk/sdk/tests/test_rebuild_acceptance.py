# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Check that release proof fails on byte drift and restores authored inputs."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sdk import rebuild_acceptance as acceptance


class RebuildAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sdk-proof-contract-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'sdk'
        self.root.mkdir()
        self.output = self.root.parent / 'evidence'
        self.output.mkdir()
        (self.root / 'manifest.json').write_text('{"profile":"engine"}', encoding='utf-8')
        (self.root / 'sdk-build.json').write_text('{}', encoding='utf-8')
        self.source = self.root / 'engine/core/math/MathVec3.js'
        self.source.parent.mkdir(parents=True)
        self.original = b'export const vec3 = (x = 0, y = 0, z = 0) => [x, y, z];\r\n'
        self.source.write_bytes(self.original)
        self.first_build_removed = False
        self.drift = False

    def build(self, sdk, output, label, timeout, environment):
        destination = sdk / 'build/engine-sdk'
        if label == 2:
            self.first_build_removed = not destination.exists()
        (destination / 'dist').mkdir(parents=True, exist_ok=True)
        payload = self.source.read_bytes()
        if self.drift and label == 2:
            payload += b'changed second output'
        (destination / 'dist/runtime.min.js').write_bytes(payload)
        receipt = {'bundle': {'name': 'runtime'}, 'files': {'dist/runtime.min.js': {
            'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}}}
        (destination / 'manifest.json').write_text(json.dumps(receipt), encoding='utf-8')

    def run_proof(self, probe):
        with patch.object(acceptance, '_rebuild', side_effect=self.build), \
                patch.object(acceptance, 'negative_acceptance', return_value=[]), \
                patch('bundler.sdk.verify_sdk', side_effect=lambda root: json.loads(
                    (root / 'manifest.json').read_text(encoding='utf-8'))), \
                patch.object(acceptance, 'cpu_probe', side_effect=probe):
            return acceptance.rebuild_acceptance(self.root, self.output, object(), 30)

    def test_success_requires_fresh_second_build_and_executes_changed_source(self):
        def probe(browser, sdk, output):
            self.assertIn(b'[x + 1, y, z]', (sdk / 'dist/runtime.min.js').read_bytes())
            return {'status': 'PASS'}
        report = self.run_proof(probe)
        self.assertEqual(report['status'], 'PASS')
        self.assertTrue(self.first_build_removed)
        self.assertNotEqual(report['runtimeHashes'][0], report['changedRuntimeHashes'])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_runtime_drift_fails_before_browser_proof(self):
        self.drift = True
        with self.assertRaisesRegex(AssertionError, 'different runtime bytes'):
            self.run_proof(lambda *args: self.fail('Browser proof must not mask nondeterminism'))
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_probe_failure_is_not_reported_as_success_and_restores_original_bytes(self):
        def probe(*args):
            raise AssertionError('compiled result did not change')
        with self.assertRaisesRegex(AssertionError, 'compiled result did not change'):
            self.run_proof(probe)
        self.assertEqual(self.source.read_bytes(), self.original)


if __name__ == '__main__':
    unittest.main()
