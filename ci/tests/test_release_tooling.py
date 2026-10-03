# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Exercise release validation on real local Git, archive and evidence fixtures."""
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

CI = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CI))
from aggregate import CANDIDATE_REPORT_NAMES, REQUIRED_REPORT_NAMES, STANDARD_REPORTS, aggregate
from report_context import canonical_digest, capture, digest
from ci.tests.test_aggregate import passing_cpu_report, passing_report

spec = importlib.util.spec_from_file_location('sdk_release_tooling', CI.parent / 'tools/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseToolingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='sdk-release-validation-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        environment = patch.dict(os.environ, {'GITHUB_REPOSITORY': release.REPOSITORY,
            'GITHUB_WORKFLOW': 'Fixture CI', 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
            'GITHUB_JOB': 'fixture', 'GITHUB_SHA': ''})
        environment.start()
        self.addCleanup(environment.stop)
        for name, text in {'.gitignore': '/test-results/\n', 'ci/runner.py': 'value = 1\n',
                           'engine-sdk/manifest.json': '{"version":"0.8.1"}',
                           'engine-sdk/code.js': 'export const value = 1;',
                           'release-notes.md': 'Future release: validated parser and CPU test coverage.\n'}.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        self.template = self.root / 'Template.zip'
        runtime = b'fixture runtime identity'
        receipt = {'format': 'particle-template-manifest/v1', 'profile': 'runtime-only',
                   'modes': ['canvas', 'plauna', 'os'], 'runtime': {'integrity': 'sha384-fixture'},
                   'files': {'assets/runtime.js': {'bytes': len(runtime), 'sha256': hashlib.sha256(runtime).hexdigest()}}}
        with zipfile.ZipFile(self.template, 'w') as archive:
            archive.writestr('Template/assets/runtime.js', runtime)
            archive.writestr('Template/template-manifest.json', json.dumps(receipt))
        validation = {'status': 'PASS', 'repository': release.REPOSITORY, 'EngineSDK': {'version': '0.8.1'},
                      'Template.zip': {'sha256': digest(self.template), 'bytes': self.template.stat().st_size,
                                       'runtimeSRI': 'sha384-fixture'}}
        self.validation = validation
        (self.root / 'SDK-VALIDATION.json').write_text(json.dumps(validation), encoding='utf-8')
        self.git('init', '-q')
        self.git('config', 'user.name', 'Local CI fixture')
        self.git('config', 'user.email', 'ci-fixture@example.invalid')
        self.git('add', '.')
        self.git('commit', '-qm', 'Local release validation fixture')
        self.git('tag', release.BASELINE)
        self.released_template_sha256 = self.validation['Template.zip']['sha256']
        # The accepted distribution upgraded its Template after alpha.1. Keep
        # those two immutable fixture commits and asset identities distinct.
        self.template.write_bytes(self.template.read_bytes() + b'accepted upgrade fixture')
        accepted = self.validation['Template.zip']
        accepted.update(sha256=digest(self.template), bytes=self.template.stat().st_size,
                        templateReceiptSha256=hashlib.sha256(json.dumps(receipt).encode()).hexdigest(),
                        donorSDKReceiptSha256='1' * 64, browserAcceptanceReportSha256='2' * 64,
                        publicationReceiptSha256='3' * 64)
        (self.root / 'SDK-VALIDATION.json').write_text(json.dumps(self.validation), encoding='utf-8')
        proof = {'schema': 'particle-template-local-upgrade-validation/v1', 'status': 'PASS', 'profile': 'runtime-only',
                 'archive': {'name': 'Template.zip', 'bytes': accepted['bytes'], 'sha256': accepted['sha256']},
                 'identity': {'templateReceiptSha256': accepted['templateReceiptSha256'],
                              'platformDonorReceiptSha256': accepted['donorSDKReceiptSha256']},
                 'delivery': {'runtime': {'integrity': accepted['runtimeSRI']}},
                 'sourceEvidenceSha256': {'acceptance': accepted['browserAcceptanceReportSha256'],
                                         'publication': accepted['publicationReceiptSha256']},
                 'checks': [{'name': 'Fixture accepted upgrade', 'status': 'PASS'}]}
        (self.root / 'validation').mkdir()
        (self.root / 'validation/template-upgrade.json').write_text(json.dumps(proof), encoding='utf-8')
        self.git('add', '.')
        self.git('commit', '-qm', 'Accepted distribution Template upgrade fixture')
        accepted_commit = self.git('rev-parse', 'HEAD').strip()
        pinned = patch.object(release, 'ACCEPTED_DISTRIBUTION_COMMIT', accepted_commit)
        pinned.start()
        self.addCleanup(pinned.stop)
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.notes = self.root / 'release-notes.md'
        self.evidence_path = self.root / 'test-results/evidence/aggregate.json'
        self.child_path = self.evidence_path.parent / 'children/cpu.json'
        self.write_evidence()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True, stderr=subprocess.PIPE, timeout=30)

    def write_evidence(self):
        candidate = self.root / 'test-results/rebuilt-sdk'
        shutil.copytree(self.root / 'engine-sdk', candidate, dirs_exist_ok=True)
        base_context, candidate_context = capture(self.root), capture(self.root, candidate=candidate)
        self.child_path.parent.mkdir(parents=True, exist_ok=True)
        children, sources = {}, {}
        for name in STANDARD_REPORTS:
            context = deepcopy(candidate_context if name in CANDIDATE_REPORT_NAMES else base_context)
            context['job'] = name
            child = passing_cpu_report() if name in {'cpu', 'candidate-cpu'} else passing_report(name)
            child.update(context=context, testedPackage=deepcopy(context['candidate'] or context['sdk']),
                         identityVerification={'status': 'PASS', 'changes': [], 'context': deepcopy(context)})
            if name in {'browser-off', 'browser-software'}:
                child.update(webgpu=name.removeprefix('browser-'),
                             gpuSuite={'status': 'NOT_RUN' if name == 'browser-off' else 'PASS'})
            path = self.child_path.parent / (name + '.json')
            path.write_text(json.dumps(child), encoding='utf-8')
            children[name] = child
            sources[name] = {'artifactPath': 'children/' + path.name, 'sha256': digest(path)}
        report = aggregate(children)
        self.assertEqual(report['status'], 'PASS', report['errors'])
        report['sources'] = sources
        self.evidence_path.write_text(json.dumps(report), encoding='utf-8')

    def validate(self, **changes):
        arguments = {'tag': 'v0.8.1-alpha.2', 'commit': self.commit, 'notes': self.notes,
                     'evidence_path': self.evidence_path}
        arguments.update(changes)
        return release.validate(self.root, **arguments)

    def test_local_default_revalidates_real_archive_and_children_without_network(self):
        with patch.object(release, 'api') as api, patch.object(release, 'github_headers') as auth:
            plan = self.validate()
            api.assert_not_called()
            auth.assert_not_called()
        self.assertEqual(plan['status'], 'PASS')
        self.assertEqual(set(plan['assets']), {'Template.zip'})
        self.assertTrue(plan['assets']['Template.zip']['carriedUnchanged'])
        self.assertNotEqual(plan['assets']['Template.zip']['sha256'], self.released_template_sha256)
        self.assertEqual(plan['acceptedTemplateEvidence']['kind'], 'historical')
        self.assertEqual(plan['commit'], self.commit)

    def test_old_tags_inexact_or_untested_commits_and_dirty_checkout_fail(self):
        for arguments in ({'tag': release.BASELINE}, {'commit': self.commit[:12]}, {'commit': 'f' * 40}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                self.validate(**arguments)
        (self.root / 'untracked.txt').write_text('dirty', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'uncommitted'):
            self.validate()

    def test_tampered_original_children_and_artifact_escape_fail(self):
        self.child_path.write_text('{"status":"PASS"}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'changed or is missing'):
            self.validate()
        self.write_evidence()
        report = json.loads(self.evidence_path.read_text(encoding='utf-8'))
        report['sources']['cpu']['artifactPath'] = '../outside.json'
        self.evidence_path.write_text(json.dumps(report), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'escapes'):
            self.validate()

    def test_recomputed_hash_cannot_hide_skipped_or_mixed_child_evidence(self):
        for mutate in ('skip', 'identity'):
            self.write_evidence()
            child = json.loads(self.child_path.read_text(encoding='utf-8'))
            if mutate == 'skip':
                child['checks'][0]['status'] = 'SKIP'
            else:
                child['context']['commit'] = 'f' * 40
            self.child_path.write_text(json.dumps(child), encoding='utf-8')
            report = json.loads(self.evidence_path.read_text(encoding='utf-8'))
            report['sources']['cpu']['sha256'] = digest(self.child_path)
            self.evidence_path.write_text(json.dumps(report), encoding='utf-8')
            with self.subTest(mutate=mutate), self.assertRaisesRegex(ValueError, 'contradicts'):
                self.validate()

    def test_one_passing_report_or_missing_required_report_cannot_qualify_release(self):
        for names in ({'cpu'}, REQUIRED_REPORT_NAMES - {'parser'}):
            self.write_evidence()
            original = json.loads(self.evidence_path.read_text(encoding='utf-8'))
            children = {name: json.loads((self.child_path.parent / (name + '.json')).read_text(encoding='utf-8')) for name in names}
            smaller = aggregate(children)
            self.assertEqual(smaller['status'], 'PASS')
            smaller['sources'] = {name: original['sources'][name] for name in names}
            self.evidence_path.write_text(json.dumps(smaller), encoding='utf-8')
            with self.subTest(names=names), self.assertRaisesRegex(ValueError, 'complete current required'):
                self.validate()

    def test_wrong_typed_receipt_cannot_replace_cpu_even_with_recomputed_hashes(self):
        wrong = json.loads((self.child_path.parent / 'distribution.json').read_text(encoding='utf-8'))
        self.child_path.write_text(json.dumps(wrong), encoding='utf-8')
        report = json.loads(self.evidence_path.read_text(encoding='utf-8'))
        report['sources']['cpu']['sha256'] = digest(self.child_path)
        next(row for row in report['reports'] if row['name'] == 'cpu')['reportSha256'] = canonical_digest(wrong)
        self.evidence_path.write_text(json.dumps(report), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'contradicts'):
            self.validate()

    def commit_version(self, version):
        (self.root / 'engine-sdk/manifest.json').write_text(json.dumps({'version': version}), encoding='utf-8')
        self.validation['EngineSDK']['version'] = version
        (self.root / 'SDK-VALIDATION.json').write_text(json.dumps(self.validation), encoding='utf-8')
        self.git('add', '.')
        self.git('commit', '-qm', 'Fixture future SDK version')
        self.commit = self.git('rev-parse', 'HEAD').strip()

    def test_committed_version_must_match_the_explicit_future_tag(self):
        self.commit_version('0.8.2')
        self.write_evidence()
        with self.assertRaisesRegex(ValueError, 'version must match'):
            self.validate()

    def test_explicit_future_sdk_version_with_fresh_matching_evidence_is_permitted(self):
        baseline = self.git('rev-parse', release.BASELINE).strip()
        self.commit_version('0.8.2')
        self.write_evidence()
        plan = self.validate(tag='v0.8.2-alpha.1')
        self.assertEqual(plan['status'], 'PASS')
        self.assertEqual(self.git('rev-parse', release.BASELINE).strip(), baseline)
        self.assertTrue(plan['assets']['Template.zip']['carriedUnchanged'])

    def test_future_version_cannot_reuse_older_commit_or_package_evidence(self):
        self.commit_version('0.8.2')
        with self.assertRaisesRegex(ValueError, 'Release bytes differ'):
            self.validate(tag='v0.8.2-alpha.1')

    def test_rewritten_template_receipt_cannot_bypass_full_platform_donor(self):
        self.template.write_bytes(self.template.read_bytes() + b'repacked fixture')
        self.validation['Template.zip'].update(sha256=digest(self.template), bytes=self.template.stat().st_size)
        (self.root / 'SDK-VALIDATION.json').write_text(json.dumps(self.validation), encoding='utf-8')
        self.git('add', '.')
        self.git('commit', '-qm', 'Fixture rewritten asset receipt')
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.write_evidence()
        with self.assertRaisesRegex(ValueError, 'full Platform donor'):
            self.validate()

    def test_template_replacement_requires_full_platform_donor(self):
        changed = self.root / 'test-results/changed.zip'
        changed.write_bytes(self.template.read_bytes() + b'changed archive bytes')
        with self.assertRaisesRegex(ValueError, 'full Platform donor'):
            self.validate(template=changed)
        with self.assertRaisesRegex(ValueError, 'full Platform'):
            release.verify_template(changed, self.validation['Template.zip'], self.root / 'engine-sdk', {'candidate': None})

    def test_draft_preflight_rechecks_notes_and_assets_before_authentication(self):
        plan = self.validate()
        self.template.write_bytes(self.template.read_bytes() + b'tamper')
        with patch.object(release, 'api') as api, patch.object(release, 'github_headers') as auth:
            with self.assertRaises(ValueError):
                release.stage_draft(plan)
            api.assert_not_called()
            auth.assert_not_called()

    def test_draft_rejects_published_release_and_conflicting_tag_without_mutation(self):
        plan = self.validate()
        def fixture_api(_headers, path, method='GET', payload=None, **_kwargs):
            self.assertEqual(method, 'GET', 'An immutable-release check attempted a mutation')
            if path.endswith(release.REPOSITORY):
                return {'permissions': {'push': True}}
            if '/releases?' in path:
                return [{'tag_name': plan['tag'], 'draft': False}]
            raise AssertionError(path)
        with patch.object(release, 'github_headers', return_value={}), patch.object(release, 'tag_commit', return_value=None), patch.object(release, 'api', side_effect=fixture_api), patch.object(release, 'upload') as upload:
            with self.assertRaisesRegex(ValueError, 'immutable'):
                release.stage_draft(plan)
            upload.assert_not_called()
        with patch.object(release, 'github_headers', return_value={}), patch.object(release, 'tag_commit', return_value='f' * 40), patch.object(release, 'api', side_effect=fixture_api), patch.object(release, 'upload') as upload:
            with self.assertRaisesRegex(ValueError, 'will not be moved'):
                release.stage_draft(plan)
            upload.assert_not_called()


if __name__ == '__main__':
    unittest.main()
