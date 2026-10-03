# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Audited worker, native player, thumbnail and optional depth-runtime sidecars."""
import ast
import hashlib
import json
import re
from pathlib import Path

from .graph import ModuleGraph
from .parser import find_code_token_sequence
from .scan_import_paths import scan_import_paths

AMBIENT_PLAYER_ENTRYPOINTS = (
    'webgpu-os/kernel/drivers/WebGPUSpatialAmbientDriver.js',
    'webgpu-os/kernel/drivers/WebGPUAmbientRuntimeV3Driver.js',
    'webgpu-os/kernel/drivers/WebGPUAmbientProgramDriver.js',
    'webgpu-os/kernel/drivers/WebGPUCompositeAmbientDriver.js',
    'engine/sim/particles/ambient/ParticleAmbientRuntime.js',
    'webgpu-os/kernel/GpuFrameCoordinator.js',
)
AMBIENT_WORKER_ENTRYPOINTS = (
    'webgpu-os/factory/apps/ambient-studio/spatial/PreparationWorker.js',
    'webgpu-os/factory/apps/ambient-studio/spatial/DepthInferenceWorker.js',
)


def _ambient_collection_thumbnail_paths(root):
    """Ship the reviewed renderer manifest, or the older explicit PNG selection."""
    catalog = root / 'webgpu-os/factory/apps/ambient-studio/AmbientCollectionCatalog.js'
    directory = catalog.parent / 'assets/collection'
    source = catalog.read_text(encoding='utf-8')
    if find_code_token_sequence(source, ('export', 'const', 'AMBIENT_COLLECTION_PREVIEW_MANIFEST', '='), brace_depth=0):
        manifest_path = directory / 'rendered/manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        entries = manifest.get('entries', [])
        if len(entries) != 52 or len({entry.get('id') for entry in entries}) != 52:
            raise ValueError('Ambient rendered previews require all 52 unique collection identities')
        for entry in entries:
            identifier = entry.get('id', '')
            if not isinstance(identifier, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', identifier) or entry.get('file') != f'{identifier}.jpg':
                raise ValueError('Ambient rendered preview has an unsafe or unrelated filename')
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', str(entry.get('planHash', ''))):
                raise ValueError('Ambient rendered preview is missing its captured plan hash')
        return (manifest_path, *(manifest_path.parent / entry['file'] for entry in entries))
    thumbnails = tuple(directory.glob('*.jpg'))
    if len(thumbnails) != 36:
        raise ValueError('Ambient collection requires all 36 source previews')
    declaration = ('const', 'NATIVE_THUMBNAILS', '=', 'new', 'Set', '(', '[')
    opening = find_code_token_sequence(source, declaration, brace_depth=0)
    closing = find_code_token_sequence(
        source, (']', ')', ';'), start=opening[1], brace_depth=0,
    ) if opening else None
    if not closing or find_code_token_sequence(source, declaration, start=closing[1], brace_depth=0):
        raise ValueError('Ambient native thumbnail selection must be one static string array')
    try:
        native_ids = ast.literal_eval('[' + source[opening[1]:closing[0]] + ']')
    except (SyntaxError, ValueError) as error:
        raise ValueError('Ambient native thumbnail selection must be one static string array') from error
    if not native_ids or any(
        not isinstance(value, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', value)
        for value in native_ids
    ):
        raise ValueError('Ambient native thumbnail selection requires safe source IDs')
    if len(native_ids) != len(set(native_ids)):
        raise ValueError('Ambient native thumbnail selection contains duplicate source IDs')
    unknown = set(native_ids).difference(path.stem for path in thumbnails)
    if unknown:
        raise ValueError('Ambient native thumbnails reference unknown source previews: ' + ', '.join(sorted(unknown)))
    return (*thumbnails, *(directory / f'{source_id}.png' for source_id in native_ids))


def ambient_release_asset_paths(root):
    """Ship the real module closure; model weights remain explicit user downloads."""
    root = Path(root).resolve()
    graph = ModuleGraph(root)
    for entry in (*AMBIENT_PLAYER_ENTRYPOINTS, *AMBIENT_WORKER_ENTRYPOINTS):
        graph.walk(entry)
    if graph.errors:
        raise ValueError('Ambient native sidecar imports are incomplete: ' + '; '.join(graph.errors))
    # General bundles permit external import maps. Standalone players and workers
    # must resolve their complete executable closure from the preserved layout.
    for filename, source in graph.modules.items():
        for specifier in scan_import_paths(source):
            if not specifier.startswith(('./', '../')):
                raise ValueError(f'Ambient sidecar import must be local and relative: {filename}: {specifier}')
    paths = {Path(filename).resolve().relative_to(root).as_posix() for filename in graph.order}
    vendor = root / 'vendor/transformers/3.8.1'
    provenance = json.loads((vendor / 'provenance.json').read_text(encoding='utf-8'))
    if provenance['version'] != '3.8.1':
        raise ValueError('Ambient depth runtime version drift')
    for item in provenance['files']:
        path = (vendor / item['file']).resolve()
        path.relative_to(vendor)
        content = path.read_bytes()
        if len(content) != item['bytes'] or hashlib.sha256(content).hexdigest() != item['sha256']:
            raise ValueError(f'Ambient depth runtime integrity failed: {item["file"]}')
        paths.add(path.relative_to(root).as_posix())
    paths.update((path.relative_to(root).as_posix() for path in (vendor / 'provenance.json', vendor / 'LICENSE-onnxruntime')))
    paths.update(path.relative_to(root).as_posix() for path in _ambient_collection_thumbnail_paths(root))
    for relative in paths:
        if not (root / relative).is_file():
            raise FileNotFoundError(f'Missing Ambient sidecar: {relative}')
    return tuple(sorted(paths))
