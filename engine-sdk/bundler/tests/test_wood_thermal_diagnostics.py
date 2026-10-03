# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Explicit metadata vectors; these tests do not execute native thermal physics."""
import copy
import hashlib
import json
import unittest

from bundler import wood_thermal_diagnostics as gate


def vector():
    pair = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
    sources = dict.fromkeys(gate.SOURCES, 'c' * 64)
    build = {'thermalIncluded': True, 'thermalAbi': 2, 'thermalNumericalVersion': 9,
        'sources': sources, 'bridge_sources': sources, 'expectedAddonExports': gate.EXPORTS,
        'thermalCompileCommand': ['em++', '-O3', '-fno-fast-math', '-fno-associative-math',
            '-ffp-contract=off', '-msimd128', '-DPR_THERMAL_STABLE_DEPLETION=1']}
    served = {'/engine/sim/physics/' + name: digest for name, digest in pair.items()}
    served.update({'/diagnostic/' + name: digest for name, digest in gate.FIXTURES.items()})
    cases = []
    for name in sorted(gate.CASES):
        evidence = {}
        if name.startswith('coupled-radau-'):
            evidence = {'factor': int(name.rsplit('-', 1)[-1]), 'complete': True,
                'failure': None, 'mode': name[len('coupled-radau-'):].rsplit('-tolerance-', 1)[0]}
        cases.append({'name': name, 'status': 'PASS', 'evidence': evidence})
    proof = {'status': 'PASS', 'sourceHashes': sources, 'sourceHashesAfter': sources,
        'sourceUnchanged': True, 'changedServedSources': {}, 'pageErrors': [], 'consoleErrors': [],
        'httpErrors': [], 'requestFailures': [], 'servedSourceHashes': served,
        'unifiedRuntime': {'build': build}, 'native': {'status': 'PASS', 'cases': cases,
            'numericalVersion': 9, 'numericalAdmission': {'status': 'DIAGNOSTIC_ONLY'},
            'thermalRuntime': {'mode': 'shared-engine-heap', 'sharedEngineModule': True,
                'baseAbi': 1, 'multirateAbi': 2, 'numericalVersion': 9, 'exports': gate.EXPORTS,
                'loaderUrl': '/engine/sim/physics/physx-pe.mjs',
                'wasmUrl': '/engine/sim/physics/physx-pe.wasm'}}}
    return proof, pair, build


def check(proof, pair, build):
    raw = json.dumps(proof, allow_nan=False).encode()
    return gate.verify_wood_thermal_diagnostics(proof, pair, build,
        raw_bytes=raw, raw_sha256=hashlib.sha256(raw).hexdigest())


class WoodThermalDiagnosticTests(unittest.TestCase):
    def test_integrity_does_not_admit_accuracy_or_realtime(self):
        proof, pair, build = vector()
        result = check(proof, pair, build)
        self.assertEqual(result['status'], 'DIAGNOSTIC_ONLY')
        self.assertEqual(result['executedCases'], 15)
        self.assertIs(gate.CAPABILITIES['woodThermalDefaultEnabled'], False)

    def test_raw_bytes_cannot_be_substituted_or_rewritten(self):
        proof, pair, build = vector()
        raw = json.dumps(proof).encode()
        digest = hashlib.sha256(raw).hexdigest()
        for value in (None, raw + b'\n'):
            with self.subTest(value=type(value)), self.assertRaises(ValueError):
                gate.verify_wood_thermal_diagnostics(proof, pair, build,
                    raw_bytes=value, raw_sha256=digest)

    def test_unified_identity_and_source_revision_are_required(self):
        for key, value in [('sharedEngineModule', False), ('baseAbi', True),
                           ('multirateAbi', 1), ('numericalVersion', 8), ('exports', gate.EXPORTS[:-1])]:
            proof, pair, build = vector()
            proof['native']['thermalRuntime'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): check(proof, pair, build)

    def test_diagnostic_cannot_be_relabelled_as_production(self):
        proof, pair, build = vector()
        proof['native']['numericalAdmission']['status'] = 'PASS'
        with self.assertRaisesRegex(ValueError, 'cannot be promoted'): check(proof, pair, build)

    def test_strict_controls_and_complete_native_selection(self):
        for mutation in ('fast', 'depletion', 'source', 'pair', 'fixture'):
            proof, pair, build = vector()
            if mutation == 'fast': build['thermalCompileCommand'].append('-ffast-math')
            if mutation == 'depletion': build['thermalCompileCommand'].remove('-DPR_THERMAL_STABLE_DEPLETION=1')
            if mutation == 'source': del build['bridge_sources'][next(iter(gate.SOURCES))]
            if mutation == 'pair': proof['servedSourceHashes']['/engine/sim/physics/physx-pe.wasm'] = 'e' * 64
            if mutation == 'fixture': proof['servedSourceHashes']['/diagnostic/wood_thermal_mri_runtime.mjs'] = 'e' * 64
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): check(proof, pair, build)

    def test_incomplete_or_failed_study_rejects(self):
        for mutation in ('missing', 'failed', 'incomplete', 'factor'):
            proof, pair, build = vector()
            if mutation == 'missing': proof['native']['cases'].pop()
            elif mutation == 'failed': proof['native']['cases'][0]['status'] = 'FAIL'
            else:
                row = next(c for c in proof['native']['cases'] if c['name'].startswith('coupled-radau-'))
                row['evidence']['complete' if mutation == 'incomplete' else 'factor'] = False
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): check(proof, pair, build)


if __name__ == '__main__':
    unittest.main()
