# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Validate a future release locally; stage a draft only with explicit --draft."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ci'))
from aggregate import REQUIRED_REPORT_NAMES, aggregate, evidence_errors
from report_context import ACCEPTED_DISTRIBUTION_COMMIT, capture, digest, inventory

REPOSITORY = 'BTSpaniel/particlerealms.engine'
BASELINE = 'v0.8.1-alpha.1'
API_ROOT = 'https://api.github.com'
RELEASE_ASSET_NAMES = frozenset({'Template.zip'})

# Tag, authenticated API and upload helpers are maintained versions of the
# previously used artifacts/engine-release/publish_github_release.py helpers.
def github_headers():
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if not token:
        environment = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never', GCM_GUI_PROMPT='0')
        result = subprocess.run(['git', '-c', 'credential.interactive=never', 'credential', 'fill'],
                                input='protocol=https\nhost=github.com\n\n', text=True,
                                capture_output=True, env=environment, timeout=30)
        if result.returncode:
            raise RuntimeError('Noninteractive GitHub authentication is unavailable')
        values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        token = values.get('password')
    if not token:
        raise RuntimeError('GitHub authentication contains no token')
    return {'Authorization': 'Bearer ' + token, 'User-Agent': 'Particle-SDK-release',
            'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}


def api(headers, path, method='GET', payload=None, *, allow_missing=False):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    request = urllib.request.Request(API_ROOT + path, data=data, method=method,
                                     headers={**headers, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return None if response.status == 204 else json.load(response)
    except urllib.error.HTTPError as error:
        if allow_missing and method == 'GET' and error.code == 404:
            return None
        raise RuntimeError(f'GitHub API {method} {path} returned HTTP {error.code}') from None


def tag_commit(headers, prefix, tag):
    reference = api(headers, prefix + '/git/ref/tags/' + urllib.parse.quote(tag, safe=''), allow_missing=True)
    if reference is None:
        return None
    target, visited = reference['object'], set()
    for _ in range(16):
        identity = target.get('sha')
        if not isinstance(identity, str) or not re.fullmatch(r'[0-9a-f]{40}', identity):
            raise ValueError('GitHub tag target has an invalid object identity')
        if target.get('type') == 'commit':
            return identity
        if target.get('type') != 'tag' or identity in visited:
            raise ValueError('Release tag does not resolve to one commit')
        visited.add(identity)
        target = api(headers, prefix + '/git/tags/' + identity)['object']
    raise ValueError('Release tag has too many annotated indirections')


def verify_draft(release, plan, body):
    if (release.get('tag_name') != plan['tag'] or release.get('draft') is not True
            or release.get('target_commitish') != plan['commit'] or release.get('body') != body
            or release.get('name') != plan['title'] or release.get('prerelease') is not True):
        raise ValueError('Draft differs from the verified release plan')


def verified_assets(headers, path, assets):
    remote = {item['name']: item for item in api(headers, path)}
    if set(remote) != set(assets) or any(remote[name].get('digest') != 'sha256:' + assets[name]['sha256']
                                      or remote[name].get('size') != assets[name]['bytes']
                                      or remote[name].get('state') != 'uploaded' for name in assets):
        raise ValueError('Remote asset verification failed')
    return remote


def upload(headers, release, name, source):
    url = release['upload_url'].split('{', 1)[0] + '?name=' + urllib.parse.quote(name, safe='')
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc != 'uploads.github.com':
        raise ValueError('Unexpected GitHub asset upload origin')
    connection = http.client.HTTPSConnection(parsed.netloc, timeout=180)
    try:
        connection.putrequest('POST', parsed.path + '?' + parsed.query)
        for key, value in {**headers, 'Content-Type': 'application/octet-stream',
                           'Content-Length': str(source.stat().st_size)}.items():
            connection.putheader(key, value)
        connection.endheaders()
        last_progress, sent = time.monotonic(), 0
        with source.open('rb') as stream:
            while block := stream.read(1024 * 1024):
                connection.send(block)
                sent += len(block)
                if time.monotonic() - last_progress >= 25:
                    print(f'[release][upload] name={name} bytesSent={sent}', flush=True)
                    last_progress = time.monotonic()
        response = connection.getresponse()
        payload = response.read()
        if response.status != 201:
            raise RuntimeError(f'GitHub upload {name} returned HTTP {response.status}')
        return json.loads(payload)
    finally:
        connection.close()


def future_tag(tag: str) -> bool:
    match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)', tag)
    return bool(match) and tuple(map(int, match.groups())) > (0, 8, 1, 1)


def accepted_template(root: Path) -> tuple[dict, dict]:
    """Read the accepted Git distribution asset and its exact historical proof."""
    def read(name):
        return subprocess.check_output(['git', 'show', ACCEPTED_DISTRIBUTION_COMMIT + ':' + name], cwd=root, timeout=30)

    receipt_raw, proof_raw = read('SDK-VALIDATION.json'), read('validation/template-upgrade.json')
    receipt, proof = json.loads(receipt_raw), json.loads(proof_raw)
    accepted = receipt['Template.zip']
    archive, identity = proof.get('archive', {}), proof.get('identity', {})
    if (receipt.get('status') != 'PASS' or receipt.get('repository') != REPOSITORY
            or proof.get('schema') != 'particle-template-local-upgrade-validation/v1'
            or proof.get('profile') != 'runtime-only' or evidence_errors(proof)
            or archive.get('name') != 'Template.zip'
            or any(archive.get(key) != accepted.get(key) for key in ('bytes', 'sha256'))
            or identity.get('templateReceiptSha256') != accepted.get('templateReceiptSha256')
            or identity.get('platformDonorReceiptSha256') != accepted.get('donorSDKReceiptSha256')
            or proof.get('delivery', {}).get('runtime', {}).get('integrity') != accepted.get('runtimeSRI')
            or proof.get('sourceEvidenceSha256', {}).get('acceptance') != accepted.get('browserAcceptanceReportSha256')
            or proof.get('sourceEvidenceSha256', {}).get('publication') != accepted.get('publicationReceiptSha256')):
        raise ValueError('Accepted Template upgrade proof contradicts the pinned Git distribution receipt')
    return accepted, {'kind': 'historical', 'commit': ACCEPTED_DISTRIBUTION_COMMIT,
                      'receiptSha256': hashlib.sha256(receipt_raw).hexdigest(),
                      'upgradeProofSha256': hashlib.sha256(proof_raw).hexdigest(),
                      'scope': 'Previously accepted Template bytes; current required evidence remains separate'}


def verify_template(path: Path, accepted: dict, donor: Path | None, evidence: dict) -> dict:
    record = {'bytes': path.stat().st_size, 'sha256': digest(path)}
    carried = all(record[key] == accepted[key] for key in record)
    with zipfile.ZipFile(path) as archive:
        names = set()
        for member in archive.infolist():
            parts = PurePosixPath(member.filename)
            if (parts.is_absolute() or '..' in parts.parts or '\\' in member.filename or ':' in member.filename
                    or not member.filename.startswith('Template/') or member.filename in names
                    or member.external_attr >> 16 & 0o170000 == 0o120000):
                raise ValueError('Unsafe or duplicate Template member')
            names.add(member.filename)
        receipt = json.loads(archive.read('Template/template-manifest.json'))
        if receipt.get('format') != 'particle-template-manifest/v1' or receipt.get('profile') != 'runtime-only':
            raise ValueError('Unsupported Template inventory')
        expected = {'Template/' + name for name in receipt['files']} | {'Template/template-manifest.json'}
        if {name for name in names if not name.endswith('/')} != expected:
            raise ValueError('Template membership differs from its inventory')
        for name, member in receipt['files'].items():
            data = archive.read('Template/' + name)
            if len(data) != member['bytes'] or hashlib.sha256(data).hexdigest() != member['sha256']:
                raise ValueError('Template member identity changed: ' + name)
        if set(receipt.get('modes', [])) != {'canvas', 'plauna', 'os'}:
            raise ValueError('Template must retain all Platform launcher modes')
        if carried:
            if receipt['runtime']['integrity'] != accepted['runtimeSRI']:
                raise ValueError('Accepted Template runtime identity changed')
        else:
            if donor is None:
                raise ValueError('Template replacement requires a verified full Platform donor')
            manifest = json.loads((donor / 'manifest.json').read_text(encoding='utf-8'))
            if (manifest.get('profile') != 'platform' or manifest.get('bundle', {}).get('target') != 'platform'
                    or not all(manifest['bundle'].get('include_' + name) is True for name in ('editor', 'agi', 'plauna', 'webgpu_os'))):
                raise ValueError('Template donor must contain the full Platform; Engine-only reconstruction is forbidden')
            donor_identity = inventory(donor)
            if evidence.get('candidate') != donor_identity:
                raise ValueError('Full Platform donor has no matching current acceptance evidence')
            if manifest['bundle']['browser_runtime_integrity'] != receipt['runtime']['integrity']:
                raise ValueError('Template runtime differs from accepted Platform donor')
            # Reuse the checked-in verifier's runtime, provenance, public graph,
            # native sidecar and recorded rebuild contracts for the full donor.
            sys.path.insert(0, str(ROOT / 'engine-sdk'))
            from bundler.sdk import verify_sdk
            verify_sdk(donor)
    return {**record, 'carriedUnchanged': carried, 'runtimeSRI': receipt['runtime']['integrity']}


def validate(root: Path, *, tag: str, commit: str, notes: Path, evidence_path: Path,
             template: Path | None = None, donor: Path | None = None) -> dict:
    if not future_tag(tag):
        raise ValueError('Explicit future alpha tag required; preserved release tags cannot be mutated')
    if not re.fullmatch(r'[0-9a-f]{40}', commit or ''):
        raise ValueError('Exact tested 40-character commit required')
    current = capture(root)
    if current['repository'] != REPOSITORY or current['commit'] != commit:
        raise ValueError('Release must identify this repository and its exact checked-out tested commit')
    if current.get('workingTreeClean') is not True:
        raise ValueError('Release checkout contains uncommitted changes or cannot be verified')
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=root, text=True, timeout=30)
    if dirty.strip():
        raise ValueError('Release checkout contains uncommitted changes')
    validation = json.loads((root / 'SDK-VALIDATION.json').read_text(encoding='utf-8'))
    sdk_manifest = json.loads((root / 'engine-sdk/manifest.json').read_text(encoding='utf-8'))
    baseline_manifest = json.loads(subprocess.check_output(
        ['git', 'show', BASELINE + ':engine-sdk/manifest.json'], cwd=root, timeout=30))
    if baseline_manifest.get('version') != '0.8.1':
        raise ValueError('Preserved alpha.1 SDK baseline changed')
    version = tag[1:].split('-alpha.', 1)[0]
    if sdk_manifest['version'] != version or sdk_manifest['version'] != validation['EngineSDK']['version']:
        raise ValueError('SDK and accepted distribution version must match the explicit future tag; this tool never rewrites versions')
    evidence = json.loads(evidence_path.read_text(encoding='utf-8'))
    if evidence.get('schema') != 'particle-sdk-ci-aggregate/v1' or evidence.get('status') != 'PASS':
        raise ValueError('Current passing aggregate evidence required')
    records = evidence.get('reports')
    if not isinstance(records, list) or any(not isinstance(item, dict) or not isinstance(item.get('name'), str) for item in records):
        raise ValueError('The complete current required CI report set is mandatory')
    required = [item['name'] for item in records]
    if len(required) != len(REQUIRED_REPORT_NAMES) or set(required) != REQUIRED_REPORT_NAMES:
        raise ValueError('The complete current required CI report set is mandatory')
    if set(evidence.get('sources', {})) != set(required):
        raise ValueError('Aggregate must retain every original required report')
    children = {}
    for name, source in evidence['sources'].items():
        # Original reports travel with the aggregate under artifact-relative paths.
        relative = source.get('artifactPath')
        if not isinstance(relative, str):
            raise ValueError('Original reports require artifact-relative identities')
        path = (evidence_path.parent / relative).resolve()
        if not path.is_relative_to(evidence_path.parent.resolve()):
            raise ValueError('Original aggregate evidence escapes its artifact')
        if not path.is_file() or digest(path) != source['sha256']:
            raise ValueError('Original aggregate evidence changed or is missing: ' + name)
        children[name] = json.loads(path.read_text(encoding='utf-8'))
    checked = aggregate(children, required=required)
    if checked['status'] != 'PASS' or any(checked.get(key) != evidence.get(key) for key in ('context', 'candidate', 'reports', 'requiredCount', 'executedCount')):
        raise ValueError('Aggregate contradicts its original required evidence')
    identity = checked['context']
    if any(identity.get(key) != current.get(key) for key in ('repository', 'commit', 'recipe', 'sdk', 'template')):
        raise ValueError('Release bytes differ from the accepted tested commit and inputs')
    body = notes.read_text(encoding='utf-8')
    if not body.strip():
        raise ValueError('Explicit nonempty release notes required')
    template = Path(template or root / 'Template.zip')
    # The accepted f4 distribution upgraded Template after alpha.1. Bind that
    # actual accepted asset and proof, rather than the old release asset or a
    # mutable current receipt. A subsequent replacement needs a full donor.
    accepted, accepted_evidence = accepted_template(root)
    asset = verify_template(template, accepted, donor, checked)
    return {'schema': 'particle-sdk-release-plan/v1', 'status': 'PASS', 'repository': REPOSITORY,
            'tag': tag, 'commit': commit, 'title': 'Particle Realms ' + tag, 'prerelease': True,
            'notes': str(notes.resolve()), 'notesSha256': digest(notes),
            'evidence': str(evidence_path.resolve()), 'evidenceSha256': digest(evidence_path),
            'checkoutRoot': str(root.resolve()), 'platformDonor': str(donor.resolve()) if donor is not None else None,
            'context': current,
            'acceptedTemplateEvidence': accepted_evidence,
            'assets': {'Template.zip': {**asset, 'path': str(template.resolve())}},
            'scope': 'Validated locally; no tag, release or upload mutation unless explicitly staged as a draft.'}


def stage_draft(plan: dict):
    if (plan.get('status') != 'PASS' or plan.get('repository') != REPOSITORY
            or not future_tag(plan.get('tag', '')) or set(plan.get('assets', {})) != RELEASE_ASSET_NAMES):
        raise ValueError('Only a validated future Template-only draft may be staged')
    # No authentication or remote call occurs until every original child report,
    # current checkout, note and asset has been revalidated against the plan.
    verified = validate(Path(plan['checkoutRoot']), tag=plan['tag'], commit=plan['commit'],
                        notes=Path(plan['notes']), evidence_path=Path(plan['evidence']),
                        template=Path(plan['assets']['Template.zip']['path']),
                        donor=Path(plan['platformDonor']) if plan.get('platformDonor') else None)
    if any(verified.get(key) != plan.get(key) for key in ('context', 'assets', 'notesSha256', 'evidenceSha256', 'title')):
        raise ValueError('Release inputs changed after local validation')
    body = Path(plan['notes']).read_text(encoding='utf-8')
    headers, prefix = github_headers(), '/repos/' + REPOSITORY
    if not api(headers, prefix).get('permissions', {}).get('push'):
        raise ValueError('GitHub credential cannot stage this repository')
    target = tag_commit(headers, prefix, plan['tag'])
    if target is not None and target != plan['commit']:
        raise ValueError('Existing tag differs from tested commit; it will not be moved')
    # Paginate so an older published version cannot be missed.
    releases, page = [], 1
    while True:
        chunk = api(headers, prefix + f'/releases?per_page=100&page={page}')
        releases.extend(chunk)
        if len(chunk) < 100:
            break
        page += 1
    matching = [item for item in releases if item['tag_name'] == plan['tag']]
    if any(not item['draft'] for item in matching):
        raise ValueError('Published versions and their assets are immutable')
    if len(matching) > 1:
        raise ValueError('Multiple drafts claim this future release tag')
    release = matching[0] if matching else None
    if release is None:
        release = api(headers, prefix + '/releases', 'POST', {'tag_name': plan['tag'], 'target_commitish': plan['commit'],
                      'name': plan['title'], 'body': body, 'draft': True, 'prerelease': True})
    verify_draft(release, plan, body)
    path = prefix + f'/releases/{release["id"]}/assets?per_page=100'
    existing = {item['name']: item for item in api(headers, path)}
    if set(existing) - RELEASE_ASSET_NAMES:
        raise ValueError('Draft contains an unexpected asset')
    for name, record in plan['assets'].items():
        source = Path(record['path'])
        if digest(source) != record['sha256'] or source.stat().st_size != record['bytes']:
            raise ValueError('Template changed after validation')
        if name not in existing:
            upload(headers, release, name, source)
    remote = verified_assets(headers, path, plan['assets'])
    return {'status': 'PASS', 'draft': True, 'tag': plan['tag'], 'commit': plan['commit'],
            'url': release['html_url'], 'assets': {name: {'sha256': row['digest'][7:], 'bytes': row['size']} for name, row in remote.items()}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--tested-commit', required=True)
    parser.add_argument('--notes', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--template', type=Path)
    parser.add_argument('--platform-donor', type=Path)
    parser.add_argument('--draft', action='store_true', help='Explicitly create/upload a future draft; never publish or move tags')
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/release-plan.json')
    args = parser.parse_args(argv)
    if args.output.resolve().is_relative_to((ROOT / 'engine-sdk').resolve()):
        parser.error('--output must be outside engine-sdk/')
    try:
        report = validate(ROOT, tag=args.tag, commit=args.tested_commit, notes=args.notes,
                          evidence_path=args.evidence, template=args.template, donor=args.platform_donor)
        if args.draft:
            report['draft'] = stage_draft(report)
    except (OSError, ValueError, subprocess.SubprocessError, RuntimeError, zipfile.BadZipFile, KeyError, TypeError, ImportError) as error:
        report = {'schema': 'particle-sdk-release-plan/v1', 'status': 'FAIL', 'error': str(error)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('[release] ' + report['status'] + (' draft requested' if args.draft else ' local validation only'))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
