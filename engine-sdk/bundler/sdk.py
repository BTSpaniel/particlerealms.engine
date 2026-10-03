# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Build, verify and transactionally publish browser-native source SDKs."""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import lzma
import shutil
import tempfile
import time
import zipfile
import zlib
from pathlib import Path

from .graph import ModuleGraph
from .official_inventory import verify_official_package_sidecars
from .physics import physics_release_asset_paths, verify_physics_sidecars
from .runtime_transport import read_compressed_artifact
from . import site
from .transform import is_shader_file, preprocess_shader_source

SDK_FORMAT = 'particle-sdk-manifest/v1'
SDK_DOCS_VALIDATION_INPUTS = ('tests/guide/index.html', 'tests/api/index.html',
                             'tests/common/docs-portal.css', 'tests/404.html')
_SOURCE_SUFFIXES = {'.js', '.mjs', '.py', '.json', '.md', '.css', '.html', '.wgsl',
                    '.svg', '.rs', '.toml', '.lock', '.txt', '.yml', '.yaml'}
_EXCLUDED_PARTS = {'__pycache__', '.git', '.trust-keys', 'node_modules', '.cache',
                   'build', 'dist', 'target', 'site', 'reports', 'artifacts'}


def _profile(target):
    if target not in {'engine', 'platform'}:
        raise ValueError('SDK builds require the engine or platform release target')
    return target


def _file_record(path):
    path = Path(path)
    return {'bytes': path.stat().st_size, 'sha256': site._sha256_path(path)}


def _json_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def sdk_input_file_map(root, target, manifest_files=()):
    """Resolve one copy/cache contract, including canonical rebuild-only inputs."""
    root = Path(root).resolve()
    _profile(target)
    result = {}
    sidecars = site.release_site_sidecar_asset_manifest(root)
    documents = site.document_runtime_asset_manifest(root)
    shell_assets = site.WEBGPU_OS_SHELL_ASSET_COPIES if target == 'platform' else ()
    # Published aliases belong to their declared canonical source. An extracted
    # SDK already contains these delivery paths, so the raw scan must not claim
    # them as independent inputs on the next rebuild.
    aliases = {destination for source, destination in (*sidecars, *documents, *shell_assets)
               if source != destination}
    aliases.add('editor/SnapshotWorker.js')
    if target == 'platform':
        aliases.add('webgpu-os/companion-privacy.html')
        aliases.update('webgpu-os/assets/engine-demo/' + name
                       for _, name in site.ENGINE_DEMO_RUNTIME_ASSET_COPIES)
        aliases.add('webgpu-os/assets/engine-demo/' + site.ENGINE_DEMO_RUNTIME_KIT_MANIFEST)
        aliases.add('webgpu-os/' + site.ENGINE_DEMO_STARTER_ARCHIVE_PATH)

    def add(source, destination=None):
        source = site._safe_release_relative_path(str(source), 'SDK input').as_posix()
        destination = site._safe_release_relative_path(str(destination or source), 'SDK destination').as_posix()
        path = root / source
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError(f'SDK input escapes its source root: {source}')
        if not path.is_file():
            raise FileNotFoundError(f'Required SDK input is missing: {source}')
        if result.get(destination, source) != source:
            raise ValueError(f'Conflicting SDK destination: {destination}')
        result[destination] = source

    # Keep canonical Plauna sources in both Engine variants. This makes the
    # source/rebuild inventory independent of the compiled UI option, and lets
    # cache acceptance observe changes even outside its reachable module graph.
    source_folders = ('bundler', 'jhc', 'sdk', 'engine', 'plauna')
    if target == 'platform':
        source_folders += ('editor', 'agi', 'webgpu-os')
    for folder in source_folders:
        for path in sorted((root / folder).rglob('*')):
            relative = path.relative_to(root)
            if target == 'platform' and relative.as_posix().startswith('webgpu-os/assets/engine-demo/'):
                # The kit, starter, descriptors and all physical parts belong
                # to the candidate runtime and are regenerated inside staging.
                continue
            if relative.as_posix() in aliases:
                continue
            if _EXCLUDED_PARTS.intersection(relative.parts[1:]) or path.suffix.lower() not in _SOURCE_SUFFIXES:
                continue
            # Third-party JavaScript adapters remain byte-exact source inputs.
            # Native binaries enter through independently audited inventories.
            if path.is_file():
                add(relative.as_posix())
    for folder in ('MD', 'LICENSES'):
        for path in sorted((root / folder).rglob('*')):
            relative = path.relative_to(root)
            if relative.as_posix() in aliases:
                continue
            if path.is_file() and not {'__pycache__', '.git', 'site', 'node_modules'}.intersection(relative.parts[1:]):
                add(relative.as_posix())
    # The docs viewer's shared motion resources are needed by both profiles.
    for path in sorted((root / 'plauna/motion').rglob('*')):
        if path.is_file() and path.suffix in {'.js', '.css'}:
            add(path.relative_to(root).as_posix())
    for name in ('bundle_engine.py', 'release_targets.json', 'LICENSE', 'NOTICE.md', 'AUTHORS',
                 'SECURITY.md', 'SUPPORT.md', 'CHANGELOG.md'):
        add(name)
    # The unchanged documentation validator checks these canonical website
    # contracts while rebuilding MD; keep their bytes in both extracted SDKs.
    for name in SDK_DOCS_VALIDATION_INPUTS:
        add(name)
    for name in ('llms.txt', 'llms-full.txt', 'api-index.json', 'docs-chunks.jsonl', 'api-symbols.jsonl',
                 'robots.txt', 'sitemap.xml', 'start_server.py'):
        if (root / name).is_file():
            add(name)
    license_directories = set()
    for name in manifest_files:
        if not str(name).endswith('.generated.js') or (root / name).is_file():
            add(name)
            # Preserve licenses beside transitive modules outside the ordinary
            # subsystem roots, including vendored browser-only libraries.
            directory = (root / name).parent
            while directory != root and directory not in license_directories:
                license_directories.add(directory)
                for path in directory.iterdir():
                    if path.name.upper().startswith(('LICENSE', 'NOTICE', 'COPYING', 'COPYRIGHT', 'AUTHORS')) and path.is_file():
                        add(path.relative_to(root).as_posix())
                directory = directory.parent
    for source, destination in sidecars:
        if destination != 'editor/SnapshotWorker.js':
            add(source)
            add(source, destination)
    for name in physics_release_asset_paths(root):
        add(name)
    for source, destination in documents:
        add(source)
        add(source, destination)
    for source in site._morphfield_schema_sources(root):
        add(source.relative_to(root).as_posix())
        add(source.relative_to(root).as_posix(), (site.MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT / source.name).as_posix())
    if target == 'platform':
        for name in ('run_dump_built_in_tool_descriptors.py',
                     'dump-built-in-tool-descriptors.html', 'dump-built-in-tool-descriptors.js'):
            add('tests/navi/' + name)
        for relative in (*site.WEBGPU_OS_RUNTIME_ASSET_PATHS, *site.WEBGPU_OS_PWA_ASSET_PATHS):
            add('webgpu-os/' + relative)
        for source, destination in shell_assets:
            add(source)
            add(source, destination)
        for name in site.stable_network_resource_repository_paths(root):
            add(name)
        add('webgpu-os/browser-extension-store/privacy.html', 'webgpu-os/companion-privacy.html')
        for source, name in site.ENGINE_DEMO_RUNTIME_ASSET_COPIES:
            if not name.startswith('particle-platform.') and name != 'physx-pe.wasm':
                add(source)
    return dict(sorted(result.items()))


def sdk_input_snapshot(root, target, manifest_files=()):
    mapping = sdk_input_file_map(root, target, manifest_files)
    source_records = {source: _file_record(Path(root) / source) for source in sorted(set(mapping.values()))}
    records = {name: {'source': source, **source_records[source]} for name, source in mapping.items()}
    return {'mapping': mapping, 'records': records, 'sha256': _json_digest(records),
            'target': target, 'manifestFiles': list(manifest_files)}


def sdk_input_digest(root, target):
    return sdk_input_snapshot(root, target)['sha256']


def _verify_snapshot(root, snapshot):
    if 'target' in snapshot:
        current = sdk_input_file_map(root, snapshot['target'], snapshot['manifestFiles'])
        if current != snapshot['mapping']:
            added = sorted(set(current) - set(snapshot['mapping']))
            removed = sorted(set(snapshot['mapping']) - set(current))
            changed = sorted(name for name in set(current) & set(snapshot['mapping']) if current[name] != snapshot['mapping'][name])
            raise ValueError(f'SDK input membership changed during assembly: added={added[:10]} removed={removed[:10]} changed={changed[:10]}')
    checked = {}
    for destination, record in snapshot['records'].items():
        if record['source'] not in checked:
            checked[record['source']] = _file_record(Path(root) / record['source'])
        if checked[record['source']] != {key: record[key] for key in ('bytes', 'sha256')}:
            raise ValueError(f'SDK input changed during assembly: {destination}')


def _source_digest(sources):
    from .cli import _source_inventory_sha256
    return _source_inventory_sha256(sources)


def _read_verified_sdk_runtime(directory, manifest):
    runtime = read_compressed_artifact(directory, manifest['browser_runtime'], manifest,
                                       expected_bytes=manifest['browser_runtime_bytes'])
    try:
        decoded = gzip.decompress(runtime)
    except (OSError, EOFError, zlib.error) as error:
        raise ValueError('SDK gzip runtime is corrupt') from error
    integrity = 'sha384-' + base64.b64encode(hashlib.sha384(decoded).digest()).decode()
    if len(decoded) != manifest['browser_runtime_decoded_bytes'] or integrity != manifest['browser_runtime_integrity']:
        raise ValueError('SDK runtime decoded size or SRI mismatch')
    return runtime, decoded, integrity


def verify_sdk(root, *, verify_archive=None):
    """Verify a standalone tree against its inventory, runtime and public sources."""
    root = Path(root).resolve()
    receipt = site._strict_json_file(root / 'manifest.json', 'SDK receipt')
    if not isinstance(receipt, dict) or receipt.get('format') != SDK_FORMAT or receipt.get('schema_version') != 1:
        raise ValueError('Unsupported or legacy SDK receipt; rebuild this SDK')
    profile = _profile(receipt.get('profile'))
    inventory = receipt.get('files')
    if not isinstance(inventory, dict) or not inventory:
        raise ValueError('SDK file inventory is empty')
    actual = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file()}
    if actual != set(inventory) | {'manifest.json'}:
        raise ValueError('SDK file membership differs from its receipt')
    for name, record in inventory.items():
        path = root / site._safe_release_relative_path(name, 'SDK inventory')
        if path.is_symlink() or not path.resolve().is_relative_to(root) or _file_record(path) != record:
            raise ValueError(f'SDK file integrity mismatch: {name}')
    manifest = receipt['bundle']
    if not isinstance(manifest, dict):
        raise ValueError('SDK runtime manifest must be an object')
    if manifest.get('target') != profile:
        raise ValueError('SDK target disagrees with its runtime')
    if site._strict_json_file(root / 'dist' / f"{manifest['name']}.manifest.json", 'SDK runtime manifest') != manifest:
        raise ValueError('SDK runtime manifest differs from its receipt')
    runtime, decoded, integrity = _read_verified_sdk_runtime(root / 'dist', manifest)
    minified_path = root / 'dist' / (manifest['name'] + '.min.js')
    if minified_path.is_file() and minified_path.read_bytes() != decoded:
        raise ValueError('SDK uncompressed minified runtime differs from its verified gzip')
    source_path = root / 'dist' / (manifest['name'] + '.js')
    if source_path.is_file() and 'bundle_bytes' in manifest:
        expected = manifest['bundle_bytes']
        if type(expected) is not int or expected < 1 or source_path.stat().st_size != expected:
            raise ValueError('SDK uncompressed source runtime size differs from its manifest')
    if (root / 'dist' / (manifest['name'] + '.min.js.sri')).read_text(encoding='utf-8').strip() != integrity:
        raise ValueError('SDK SRI sidecar differs from the runtime')
    for encoding, extension in (('brotli', '.br'), ('zstd', '.zst'), ('lzma', '.xz')):
        expected = manifest.get(encoding + '_bytes')
        if expected:
            payload = read_compressed_artifact(root / 'dist', manifest['name'] + '.min.js' + extension,
                                               manifest, expected_bytes=expected)
            if encoding == 'brotli':
                try:
                    import brotli
                except ImportError as error:
                    raise ValueError('SDK Brotli verification requires its recorded codec') from error
                try:
                    unpacked = brotli.decompress(payload)
                except brotli.error as error:
                    raise ValueError('SDK Brotli encoding is corrupt') from error
            elif encoding == 'zstd':
                try:
                    import zstandard
                except ImportError as error:
                    raise ValueError('SDK Zstd verification requires its recorded codec') from error
                try:
                    unpacked = zstandard.ZstdDecompressor().decompress(payload, max_output_size=len(decoded))
                except zstandard.ZstdError as error:
                    raise ValueError('SDK Zstd encoding is corrupt') from error
            else:
                try:
                    unpacked = lzma.decompress(payload)
                except lzma.LZMAError as error:
                    raise ValueError('SDK LZMA encoding is corrupt') from error
            if unpacked != decoded:
                raise ValueError(f'SDK {encoding} encoding differs from its runtime')
    provenance_record = manifest.get('provenance')
    if (not isinstance(provenance_record, dict)
            or not isinstance(provenance_record.get('path'), str)
            or provenance_record['path'] != manifest['name'] + '.provenance.json'):
        raise ValueError('SDK provenance descriptor is invalid')
    provenance_path = root / 'dist' / provenance_record['path']
    if site._sha256_path(provenance_path) != provenance_record.get('sha256'):
        raise ValueError('SDK runtime provenance mismatch')
    provenance = site._strict_json_file(provenance_path, 'SDK provenance')
    if not isinstance(provenance, dict):
        raise ValueError('SDK provenance must be an object')
    subject_records = provenance.get('subject')
    if not isinstance(subject_records, list) or not subject_records:
        raise ValueError('SDK provenance subjects must be a non-empty list')
    subjects = {}
    for item in subject_records:
        if (not isinstance(item, dict) or not isinstance(item.get('name'), str)
                or not isinstance(item.get('digest'), dict) or item['name'] in subjects):
            raise ValueError('SDK provenance subject shape or identity is invalid')
        subjects[item['name']] = item['digest'].get('sha256')
    for name, data in ((manifest['browser_runtime'], runtime), (manifest['name'] + '.min.js', decoded)):
        if subjects.get(name) != hashlib.sha256(data).hexdigest():
            raise ValueError(f'SDK provenance subject mismatch: {name}')
    predicate = provenance.get('predicate')
    definition = predicate.get('buildDefinition') if isinstance(predicate, dict) else None
    parameters = definition.get('internalParameters') if isinstance(definition, dict) else None
    if not isinstance(parameters, dict):
        raise ValueError('SDK provenance internal parameters must be an object')
    if parameters.get('sdkBuildInputsSha256') != manifest.get('sdkBuildInputsSha256') or parameters.get('buildTools') != manifest.get('buildTools'):
        raise ValueError('SDK build provenance disagrees with its manifest')
    if parameters.get('signedRegistrySha256') != manifest.get('signedRegistrySha256'):
        raise ValueError('SDK signed-package input differs from its build provenance')
    sources = {}
    for name in manifest['files']:
        source = (root / site._safe_release_relative_path(name, 'SDK module')).read_text(encoding='utf-8')
        sources[name] = preprocess_shader_source(source) if is_shader_file(name) else source
    if _source_digest(sources) != manifest['source_content_sha256']:
        raise ValueError('SDK source snapshot differs from the compiled runtime')
    graph = ModuleGraph(root)
    for entry in manifest['entries']:
        graph.walk(entry)
    if graph.errors:
        raise ValueError('Incomplete SDK public module closure: ' + '; '.join(map(str, graph.errors)))
    verify_physics_sidecars(manifest['physicsAssets'], root)
    site._verify_compute_sidecars(manifest.get('computeAssets', []), root)
    verify_official_package_sidecars(manifest.get('officialPackageAssets', []), root / 'dist')
    for logical in manifest.get('compressed_artifact_parts', {}):
        read_compressed_artifact(root / 'dist', logical, manifest)
    if manifest.get('buildTools'):
        from .sdk_rebuild import prepare_sdk_rebuild
        rebuild = prepare_sdk_rebuild(root, profile)
        registry_hash = manifest.get('signedRegistrySha256')
        if registry_hash is not None:
            preamble = rebuild['official_preamble']
            if preamble is None or hashlib.sha256(preamble.encode('utf-8')).hexdigest() != registry_hash:
                raise ValueError('SDK signed-package input differs from its supplied public registry')
        # Reuse the same owner-relative worker and native-library inventories
        # as release publication, including URLs outside the compiled graph.
        site.document_runtime_asset_manifest(root)
        site._morphfield_schema_sources(root)
        if site._sha256_path(root / 'dist/physx-pe.wasm') != site._sha256_path(root / 'engine/sim/physics/physx-pe.wasm'):
            raise ValueError('SDK loader PhysX binary differs from its native inventory')
        if profile == 'platform':
            kit = root / 'webgpu-os/assets/engine-demo'
            files = {name: kit / name for _, name in site.ENGINE_DEMO_RUNTIME_ASSET_COPIES}
            files[site.ENGINE_DEMO_RUNTIME_KIT_MANIFEST] = kit / site.ENGINE_DEMO_RUNTIME_KIT_MANIFEST
            site._validate_engine_demo_runtime_kit(files, root / 'engine/sim/physics/physx-pe.wasm')
    if verify_archive is not None:
        with zipfile.ZipFile(verify_archive) as archive:
            names = [item.filename for item in archive.infolist() if not item.is_dir()]
            if len(names) != len(set(names)) or set(names) != actual:
                raise ValueError('SDK ZIP membership differs from the published tree')
            for name in names:
                with archive.open(name) as member:
                    digest = site._sha256_stream(member)
                expected = site._sha256_path(root / name) if name == 'manifest.json' else inventory[name]['sha256']
                if digest != expected:
                    raise ValueError(f'SDK ZIP member differs: {name}')
    return receipt


def sdk_is_current(path, target=None, *, create_archive=True):
    try:
        receipt = verify_sdk(path)
        if target and receipt['profile'] != target:
            return False
        if create_archive:
            verify_sdk(path, verify_archive=Path(path).parent / (receipt['name'] + '.zip'))
        return True
    except (OSError, ValueError, KeyError, TypeError, AttributeError, ImportError, RuntimeError, zipfile.BadZipFile, zlib.error):
        return False


def _publish_sdk(stage, final, staged_archive=None, archive=None):
    """Retain recovery copies until every requested output verifies."""
    if (staged_archive is None) != (archive is None):
        raise ValueError('SDK archive promotion requires both archive paths')
    backup = Path(tempfile.mkdtemp(prefix='.sdk-rollback-', dir=final.parent))
    had_tree, had_archive = final.exists(), archive is not None and archive.exists()
    if had_tree:
        shutil.copytree(final, backup / 'tree')
    if had_archive:
        shutil.copy2(archive, backup / 'archive.zip')
    try:
        site._publish_staged_site(stage, final)
        if archive is not None:
            site._os_replace_with_retry(staged_archive, archive)
        verify_sdk(final, verify_archive=archive)
    except Exception:
        try:
            if had_tree:
                site._sync_site_tree(backup / 'tree', final)
            elif final.exists():
                shutil.rmtree(final)
            if had_archive:
                site._copy_file_atomic(backup / 'archive.zip', archive)
            elif archive is not None:
                archive.unlink(missing_ok=True)
        except Exception:
            print(f'[bundle][sdk][error] rollback failed; recovery files retained at {backup}')
            raise
        shutil.rmtree(backup)
        raise
    else:
        shutil.rmtree(backup)


def _write_sdk_pages(stage, root, manifest, profile):
    parts = manifest.get('compressed_artifact_parts', {}).get(manifest['browser_runtime'])
    runtime = read_compressed_artifact(stage / 'dist', manifest['browser_runtime'], manifest,
                                      expected_bytes=manifest['browser_runtime_bytes'])
    token = site._release_runtime_cache_token(runtime, parts)
    for source in (root / 'sdk').rglob('*'):
        if not source.is_file() or '__pycache__' in source.parts:
            continue
        relative = source.relative_to(root / 'sdk')
        if relative.parts[0] != 'examples' and relative.as_posix() not in {'index.html', 'sdk-check.js', 'server.py'}:
            continue
        destination = stage / ('serve_sdk.py' if relative.as_posix() == 'server.py' else relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix == '.html':
            prefix = '../' if relative.parts[0] == 'examples' else './'
            loader = site._release_runtime_loader_tag(prefix + 'dist/release-runtime-loader.js',
                prefix + 'dist/' + manifest['browser_runtime'], prefix + 'dist/',
                manifest['browser_runtime_integrity'], manifest['browser_runtime_decoded_bytes'],
                manifest['browser_runtime_bytes'], token, runtime_base=prefix, os_base=prefix + 'webgpu-os/',
                executor_source_hash='sha256:' + manifest['source_content_sha256'], runtime_parts=parts)
            destination.write_text(source.read_text(encoding='utf-8').replace('__SDK_LOADER__', loader)
                .replace('__SDK_PROFILE__', profile), encoding='utf-8')
        else:
            shutil.copy2(source, destination)
    (stage / 'docs').mkdir(exist_ok=True)
    (stage / 'docs/index.html').write_text('<!doctype html><meta charset="utf-8"><title>SDK documentation</title>'
        '<link rel="icon" href="data:,">'
        '<a href="../MD/viewer/?doc=guides/sdk-distribution.md">Open SDK documentation</a>', encoding='utf-8')
    for folder, title, target in (('learn', 'SDK setup', '../MD/viewer/?doc=guides/sdk-distribution.md'),
                                  ('playground', 'SDK examples', '../index.html'),
                                  ('api', 'API reference', '../MD/viewer/?doc=api/index.md')):
        (stage / folder).mkdir(exist_ok=True)
        (stage / folder / 'index.html').write_text(
            f'<!doctype html><meta charset="utf-8"><title>{title}</title>'
            f'<link rel="icon" href="data:,"><a href="{target}">{title}</a>', encoding='utf-8')
    (stage / 'README.md').write_text(f'# Particle {profile.title()} SDK\n\n'
        'Run `python serve_sdk.py --port 9001`, then open `http://127.0.0.1:9001/`. '
        'Use `--isolate` for threaded compute. Examples offer source and compiled modes.\n\n'
        'Documentation: `MD/viewer/?doc=guides/sdk-distribution.md`. '
        'The physics inventory is `engine/sim/physics/runtime-manifest.json`.\n\n'
        f'Install `requirements-sdk.txt` in a Python {manifest.get("buildTools", {}).get("python", "3.12.7")} virtual environment and provide Chrome or Edge. '
        f'Rebuild with `python bundle_engine.py --target {profile} --sdk-rebuild --no-cache`. '
        f'Outputs are `build/runtime` and `build/{profile}-sdk`. '
        'Native WASM and signed packages are verified and reused; private signing keys are not distributed.\n', encoding='utf-8')


def _write_candidate_engine_demo(stage, root, release_dir, manifest):
    destination = stage / 'webgpu-os/assets/engine-demo'
    destination.mkdir(parents=True, exist_ok=True)
    files = {}
    for source, name in site.ENGINE_DEMO_RUNTIME_ASSET_COPIES:
        if name == 'release-runtime-loader.js':
            payload = site._release_runtime_loader_bytes()
        elif name.startswith('particle-platform.'):
            payload = (release_dir / name).read_bytes()
        elif name == 'physx-pe.wasm':
            payload = (stage / 'engine/sim/physics/physx-pe.wasm').read_bytes()
        else:
            payload = (root / source).read_bytes()
        (destination / name).write_bytes(payload)
        files[name] = destination / name
    kit = destination / site.ENGINE_DEMO_RUNTIME_KIT_MANIFEST
    kit.write_bytes(site._engine_demo_runtime_kit_manifest_bytes(files))
    site._validate_engine_demo_runtime_kit({**files, kit.name: kit}, stage / 'engine/sim/physics/physx-pe.wasm')
    starter = stage / 'webgpu-os' / site.ENGINE_DEMO_STARTER_ARCHIVE_PATH
    starter.parent.mkdir(parents=True, exist_ok=True)
    site._write_engine_demo_starter_archive(destination, starter)
    site._validate_engine_demo_starter_archive(starter, destination)
    site.publish_transport(destination / 'particle-platform.min.js.gz', site.CLOUDFLARE_PAGES_MAX_FILE_BYTES)
    site.publish_transport(starter, site.CLOUDFLARE_PAGES_MAX_FILE_BYTES)
    site._validate_engine_demo_runtime_kit({**files, kit.name: kit}, stage / 'engine/sim/physics/physx-pe.wasm')
    site._validate_engine_demo_starter_archive(starter, destination)


def build_engine_sdk(root, release_dir, manifest, *, module_sources=None, raw_module_sources=None,
                     output_dir=None, official_records=None, input_snapshot=None, runtime_dir=None,
                     create_archive=True):
    """Compatibility entry point for shared Engine and Platform SDK packaging."""
    from .sdk_rebuild import sdk_tool_versions, write_sdk_build_descriptor
    root, release_dir = Path(root).resolve(), Path(release_dir).resolve()
    runtime_dir = Path(runtime_dir).resolve() if runtime_dir is not None else release_dir
    profile = _profile(manifest.get('target'))
    final = Path(output_dir).resolve() if output_dir else release_dir / (profile + '-sdk')
    final.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    print(f'[bundle][sdk][entry] profile={profile} output={final}')
    snapshot = input_snapshot or sdk_input_snapshot(root, profile, manifest['files'])
    _verify_snapshot(root, snapshot)
    print(f'[bundle][sdk][stage] name=input-verification duration_ms={(time.perf_counter() - started) * 1000:.3f}')
    with tempfile.TemporaryDirectory(prefix=profile + '-sdk-', dir=final.parent) as temporary:
        stage = Path(temporary) / 'stage'
        stage.mkdir()
        operation_start = time.perf_counter()
        site._copy_release_asset_manifest(stage, root, [(source, name) for name, source in snapshot['mapping'].items()])
        print(f'[bundle][sdk][stage] name=input-copy files={len(snapshot["mapping"])} duration_ms={(time.perf_counter() - operation_start) * 1000:.3f}')
        operation_start = time.perf_counter()
        for name, raw in (raw_module_sources or {}).items():
            if name in snapshot['mapping']:
                if (stage / name).read_text(encoding='utf-8') != raw:
                    raise ValueError(f'Graph source changed before SDK copy: {name}')
            else:
                destination = stage / site._safe_release_relative_path(name, 'SDK generated module')
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(raw, encoding='utf-8')
        if module_sources is not None and _source_digest(module_sources) != manifest['source_content_sha256']:
            raise ValueError('SDK graph identity disagrees with runtime manifest')
        shim = stage / 'editor/SnapshotWorker.js'
        shim.parent.mkdir(parents=True, exist_ok=True)
        shim.write_text('// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n'
            '// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\n'
            "import '../engine/sim/particles/SnapshotWorker.js';\n", encoding='utf-8')
        dist = stage / 'dist'
        dist.mkdir()
        name = manifest['name']
        metadata = {f'{name}.manifest.json', manifest['provenance']['path'], f'{name}.min.js.sri'}
        site._copy_release_asset_manifest(dist, release_dir, [(path, path) for path in sorted(metadata)])
        logicals = {manifest['browser_runtime'], *manifest.get('compressed_artifact_parts', {})}
        for encoding, extension in (('brotli', '.br'), ('zstd', '.zst'), ('lzma', '.xz')):
            if manifest.get(encoding + '_bytes'):
                logicals.add(name + '.min.js' + extension)
        for logical in sorted(logicals):
            site._copy_release_compressed_artifact(release_dir, dist, manifest, logical)
        _compressed, decoded, _integrity = _read_verified_sdk_runtime(dist, manifest)
        candidate_minified = runtime_dir / f'{name}.min.js'
        if candidate_minified.is_file() and candidate_minified.read_bytes() != decoded:
            raise ValueError('SDK candidate minified runtime differs from its verified gzip')
        (dist / f'{name}.min.js').write_bytes(decoded)
        source_name = f'{name}.js'
        if (runtime_dir / source_name).is_file():
            site._copy_release_asset_manifest(dist, runtime_dir, [(source_name, source_name)])
        site._copy_release_asset_manifest(dist, release_dir,
            [(item['path'], item['path']) for item in manifest.get('officialPackageAssets', [])])
        (dist / 'release-runtime-loader.js').write_bytes(site._release_runtime_loader_bytes())
        shutil.copy2(stage / 'engine/sim/physics/physx-pe.wasm', dist / 'physx-pe.wasm')
        _write_sdk_pages(stage, root, manifest, profile)
        if profile == 'platform':
            _write_candidate_engine_demo(stage, root, release_dir, manifest)
        inputs = {record['source']: {key: record[key] for key in ('bytes', 'sha256')}
                  for record in snapshot['records'].values()}
        write_sdk_build_descriptor(stage, root, profile, inputs, official_records=official_records,
                                   runtime_manifest=manifest)
        print(f'[bundle][sdk][stage] name=runtime-resources-and-descriptor duration_ms={(time.perf_counter() - operation_start) * 1000:.3f}')
        _verify_snapshot(root, snapshot)
        inventory = {path.relative_to(stage).as_posix(): _file_record(path)
                     for path in sorted(stage.rglob('*')) if path.is_file()}
        groups = {}
        for record in inventory.values():
            groups.setdefault(record['sha256'], []).append(record['bytes'])
        metrics = {'files': len(inventory), 'bytes': sum(item['bytes'] for item in inventory.values()),
                   'duplicateBytes': sum(sum(values[1:]) for values in groups.values())}
        receipt = {'format': SDK_FORMAT, 'schema_version': 1, 'name': f'particle-{profile}-sdk',
                   'profile': profile, 'target': profile, 'version': manifest['version'], 'bundle': manifest,
                   'publicEntrypoints': {entry: ('PE' if index == 0 else manifest['public_namespaces'][index - 1])
                       for index, entry in enumerate(manifest['entries'])},
                   'buildInputsSha256': snapshot['sha256'], 'tools': sdk_tool_versions(), 'files': inventory,
                   'validation': {'inventory': 'passed', 'runtime': 'passed', 'sourceClosure': 'passed'}, 'metrics': metrics}
        (stage / 'manifest.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        operation_start = time.perf_counter()
        verify_sdk(stage)
        print(f'[bundle][sdk][stage] name=tree-verification duration_ms={(time.perf_counter() - operation_start) * 1000:.3f}')
        operation_start = time.perf_counter()
        staged_archive = archive = None
        if create_archive:
            staged_archive = Path(temporary) / 'sdk.zip'
            site.create_release_site_archive(stage, staged_archive, required_paths=inventory)
            verify_sdk(stage, verify_archive=staged_archive)
            print(f'[bundle][sdk][stage] name=archive-and-verification bytes={staged_archive.stat().st_size} duration_ms={(time.perf_counter() - operation_start) * 1000:.3f}')
            archive = final.parent / (receipt['name'] + '.zip')
        operation_start = time.perf_counter()
        _publish_sdk(stage, final, staged_archive, archive)
        print(f'[bundle][sdk][stage] name=publication duration_ms={(time.perf_counter() - operation_start) * 1000:.3f}')
    print(f'[bundle][sdk][exit] profile={profile} files={metrics["files"]} bytes={metrics["bytes"]} '
          f'duplicateBytes={metrics["duplicateBytes"]} archiveBytes={archive.stat().st_size if archive else 0} '
          f'duration_ms={(time.perf_counter() - started) * 1000:.3f}')
    return receipt
