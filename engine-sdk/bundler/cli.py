# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.cli — command-line entry point (main)."""

import os
import re
import sys
import json
import gzip
import lzma
import time
import base64
import hashlib
import shutil
import argparse
from pathlib import Path
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
from .config import *
from .textscan import *
from .transform import *
from .graph import *
from .compress import *
from .builder import *
from .emitter import assert_classic_script_compatible
from .browser_syntax import assert_browser_classic_script_syntax
from .parser import (
    ParseError,
    contains_token_value_sequence,
    extract_canonical_module_registry,
)
from .site import *
from .site import _ENGINE_DEMO_PLATFORM_ENTRIES, _ENGINE_DEMO_PUBLIC_API_NAMES, _os_replace_with_retry, _release_archive_datetime
from .runtime_transport import (
    compressed_artifact_part_map,
    compressed_artifact_paths,
    plan_compressed_artifact_parts,
    read_compressed_artifact,
)
from .signing import *
from .official_inventory import (
    OFFICIAL_PACKAGE_INVENTORY_FORMAT,
    assert_manifest_official_package_inventory,
    assert_official_package_inventory_matches_source,
    official_package_inventory_from_source,
    extract_official_package_records,
    official_package_sidecar_inventory,
    verify_official_package_sidecars,
)
from .code_metrics import collect_code_metrics, write_code_metrics


# ---- Main -------------------------------------------------------------------

def _write_exact_bytes(path: Path, data: bytes) -> bytes:
    """Atomically publish exact bytes without truncating a mapped destination."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        temporary.write_bytes(data)
        _os_replace_with_retry(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return data


def _write_exact_utf8(path: Path, text: str) -> bytes:
    """Write the exact UTF-8 bytes used by size, compression, and SRI metadata."""
    data = text.encode("utf-8")
    return _write_exact_bytes(path, data)


def _prepend_sdk_official_registry(runtime: str, preamble: str) -> str:
    """Keep verified public registry bytes outside runtime compiler passes."""
    combined = preamble + '\n' + runtime
    assert_official_package_inventory_matches_source(
        combined, official_package_inventory_from_source(preamble)
    )
    return combined


def _print_runtime_consumer_receipt(receipt):
    """Report one verified consumer synchronization without duplicating CLI copy."""
    kit_suffix = ", assets only; HTML unchanged" if receipt.get("assets_only") else ""
    if receipt.get("engine_demo_runtime_kit_sha256"):
        kit_suffix = (
            f", engine-demo kit "
            f"{receipt['engine_demo_runtime_kit_sha256'][:16]}"
        )
    print(
        "[bundle] Runtime consumer: synchronized "
        f"{receipt['root']} ({receipt['decoded_bytes']:,} decoded bytes, "
        f"cache {receipt['cache_token']}{kit_suffix})"
    )


_AI_ECHO_PAUSED_RUNTIME_MODULES = frozenset({
    "webgpu-os/apps/ai-echo/EngineDemoDelivery.js",
    "webgpu-os/apps/ai-echo/EngineDemoPackage.js",
    "webgpu-os/apps/ai-echo/EngineDemoPreview.js",
    "webgpu-os/apps/ai-echo/EngineDemoRuntimeKit.js",
})


def _required_ai_echo_module_paths(root: Path) -> list[str]:
    """Return every enabled AI Echo JavaScript source required in the bundle."""
    root = Path(root)
    source_root = root / "webgpu-os" / "apps" / "ai-echo"
    if not source_root.is_dir():
        raise FileNotFoundError(f"AI Echo source directory does not exist: {source_root}")
    return sorted(
        relative
        for path in source_root.rglob("*.js")
        if path.is_file()
        for relative in (path.relative_to(root).as_posix(),)
        if relative not in _AI_ECHO_PAUSED_RUNTIME_MODULES
    )


def _required_playground_deployment_paths(root: Path) -> list[str]:
    """Return every public Playground file required in the site archive."""
    source_root = Path(root) / "tests" / "playground"
    if not source_root.is_dir():
        raise FileNotFoundError(f"Playground source directory does not exist: {source_root}")
    required = []
    for path in source_root.rglob("*"):
        if not path.is_file():
            continue
        deployment_path = "playground/" + path.relative_to(source_root).as_posix()
        if deployment_path in RELEASE_EXCLUDE:
            continue
        required.append(deployment_path)
    return sorted(required)


def _required_playground_runtime_entries(root: Path) -> tuple[str, ...]:
    """Shared, side-effect-free widgets resolved by deployed demos through PE."""
    entries = ("webgpu-os/apps/realmforge/material/studio/RealmForgeTextureStudio.js",)
    for entry in entries:
        if not (Path(root) / entry).is_file():
            raise FileNotFoundError(f"Required shared Playground runtime entry is missing: {entry}")
    return entries


def _required_engine_public_module_paths() -> tuple[str, ...]:
    """Public subsystem barrels and direct bridges every engine build must retain."""
    return (
        "engine/animation/index.js",
        "engine/assets/index.js",
        "engine/assets/rig/index.js",
        "engine/audio/index.js",
        "engine/collab/index.js",
        "engine/compat/index.js",
        "engine/core/index.js",
        "engine/core/math/ExactCalibrationEvidence.js",
        "engine/core/math/MathQuality.js",
        "engine/matter/index.js",
        "engine/matter/codec/ParticleKinematicsPageCodec.js",
        "engine/matter/fluid/index.js",
        "engine/matter/fluid/AdaptiveSphGpuNumericBounds.js",
        "engine/matter/fluid/AdaptiveSphGpuPlan.js",
        "engine/matter/fluid/AdaptiveSphGpuRuntime.js",
        "engine/matter/fluid/MixedResolutionFluidExecutionCertificate.js",
        "engine/matter/runtime/index.js",
        "engine/matter/runtime/MatterRuntimeCoordinator.js",
        "engine/network/index.js",
        "engine/render/index.js",
        "engine/render/surfaceFields/index.js",
        "engine/render/flow/index.js",
        "engine/render/morphfield/systems/ParticleCohortPlanner.js",
        "engine/state/index.js",
        "engine/surfaces/index.js",
        "engine/sim/surfaceFields/index.js",
        "engine/sim/thermodynamics/WaterThermodynamics.js",
        "engine/voxel/index.js",
        "engine/world/index.js",
        "engine/core/math/MathGeometry.js",
        "engine/core/math/MathRandom.js",
        "engine/ecs/components/ComponentRegistry.js",
        "engine/ecs/query/Query.js",
        "engine/ecs/systems/SystemRegistry.js",
        "engine/sim/physics/PhysXPhysicsWorld.js",
        "engine/sim/physics/PhysXVehicle.js",
        "engine/sim/physics/vehicle/index.js",
    )


def _required_platform_public_module_paths() -> tuple[str, ...]:
    """Load-bearing public entry modules for Editor, AGI, Plauna, and WebGPU OS."""
    return (
        "engine/EngineEditorBootstrap.js",
        "editor/js/EditorApp.js",
        "editor/js/ProjectManager.js",
        "agi/index.js",
        "agi/llm/index.js",
        "agi/tensor/ComputeGraph.js",
        "agi/tensor/Tensor.js",
        "agi/studio/core/StudioApp.js",
        "plauna/index.js",
        "plauna/core/app.js",
        "plauna/core/UINode.js",
        "plauna/core/VisualTree.js",
        "plauna/motion/PageTransition.js",
        "plauna/widgets/Primitive/Button.js",
        "plauna/widgets/Form/Input.js",
        "webgpu-os/index.js",
        "webgpu-os/kernel/KernelBootstrap.js",
        "webgpu-os/kernel/AppRegistry.js",
        "webgpu-os/kernel/Syscalls.js",
        "webgpu-os/kernel/navi/voice/ParticleVoiceOutput.js",
        "webgpu-os/factory/components/ocr/index.js",
        "webgpu-os/shell/Desktop.js",
        "webgpu-os/platform/InstallCoordinator.js",
        "webgpu-os/.bundled-os-content.generated.js",
    )


def _validate_required_bundle_modules(
    manifest_files,
    required_modules,
    label: str,
) -> int:
    """Fail a build when a required source module is absent from its manifest."""
    required = sorted(set(required_modules))
    missing = sorted(set(required).difference(manifest_files))
    if missing:
        raise RuntimeError(
            f"{label} bundle is missing required JavaScript modules:\n  "
            + "\n  ".join(missing)
        )
    print(
        f"[bundle] {label}: verified {len(required)}/{len(required)} "
        "JavaScript module(s)"
    )
    return len(required)


_PLATFORM_PUBLIC_NAMESPACES = (
    "AGI",
    "Plauna",
    "WebGPUOS",
    "WebGPUOSContent",
)

_ENGINE_DEMO_PUBLIC_SYMBOLS = OrderedDict((
    ("engine-demo", {
        "entry": "engine/EngineBootstrap.js",
        "required": _ENGINE_DEMO_PUBLIC_API_NAMES,
    }),
))

_PLATFORM_PUBLIC_SYMBOLS = OrderedDict((
    ("engine", {
        "entry": "engine/EngineEditorBootstrap.js",
        "required": (
            "createWorld", "createEntity", "stepWorld", "createQuery",
            "forEachEntity", "registerSystem", "unregisterSystem",
            "defineComponentType", "vec3", "mat4Identity",
            "createVoxelWorldRenderer", "voxel", "PhysXPhysicsWorld",
            "createPhysXVehicle", "isPhysXVehicleSupported",
            "EditorApp", "ProjectManager", "Editor",
            "createPlaunaApp", "initializePlauna",
        ),
    }),
    ("agi", {
        "entry": "agi/index.js",
        "required": (
            "PPOTrainer", "CurriculumManager", "StudioApp", "ComputeGraph",
            "TensorCache", "ModelLoader", "createAgiTrainingStateChannel",
        ),
    }),
    ("plauna", {
        "entry": "plauna/index.js",
        "required": (
            "createPlaunaApp", "UINode", "VisualTree", "PageTransition",
            "Button", "Input", "StateStore", "PlaunaGPUBridge",
        ),
    }),
    ("webgpu-os", {
        "entry": "webgpu-os/index.js",
        "required": (
            "bootWebGpuOS", "KernelBootstrap", "Desktop", "appRegistry",
            "modRegistry", "InstallCoordinator", "WEBGPU_OS_VERSION", "default",
            "particlePhysicsRuntime", "particleWovenCloth",
        ),
    }),
))

_PLATFORM_BOOTSTRAP_SYMBOLS = OrderedDict((
    ("engine-runtime", {
        "entry": "engine/EngineBootstrap.js",
        "required": (
            "createWorld", "createEntity", "registerSystem", "forEachEntity",
            "createVoxelWorldRenderer", "voxel", "Engine",
        ),
    }),
    ("engine-editor", {
        "entry": "engine/EngineEditorBootstrap.js",
        "required": (
            "Engine", "Editor", "EditorApp", "ProjectManager", "createPlaunaApp",
        ),
    }),
    ("agi-entry", {
        "entry": "agi/index.js",
        "required": ("PPOTrainer", "StudioApp", "ComputeGraph", "ModelLoader"),
    }),
    ("plauna-entry", {
        "entry": "plauna/index.js",
        "required": ("createPlaunaApp", "UINode", "VisualTree", "Button", "Input"),
    }),
    ("webgpu-os-entry", {
        "entry": "webgpu-os/index.js",
        "required": ("bootWebGpuOS", "KernelBootstrap", "Desktop", "InstallCoordinator"),
    }),
    ("webgpu-os-kernel", {
        "entry": "webgpu-os/kernel/KernelBootstrap.js",
        "required": ("KernelBootstrap", "KernelEventBus"),
    }),
))


def _platform_required_modules_by_subsystem() -> OrderedDict:
    """Return the auditable public-file contract for each platform subsystem."""
    platform = _required_platform_public_module_paths()
    return OrderedDict((
        (
            "engine",
            tuple(sorted(set((
                "engine/EngineBootstrap.js",
                *_required_engine_public_module_paths(),
                *(path for path in platform if path.startswith("engine/")),
            )))),
        ),
        ("editor", tuple(path for path in platform if path.startswith("editor/"))),
        ("agi", tuple(path for path in platform if path.startswith("agi/"))),
        ("plauna", tuple(path for path in platform if path.startswith("plauna/"))),
        ("webgpu-os", tuple(path for path in platform if path.startswith("webgpu-os/"))),
    ))


def _inventory_sha256(paths) -> str:
    """Hash a canonical newline-delimited file inventory."""
    canonical = "\n".join(sorted(set(paths))) + "\n"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _source_inventory_sha256(module_sources) -> str:
    """Hash canonical module paths and exact UTF-8 source identities.

    Length-prefixing paths and hashing each source before aggregation avoids
    delimiter ambiguity while keeping the top-level digest independent of
    dictionary iteration order.
    """
    digest = hashlib.sha256()
    for module_id in sorted(module_sources):
        path_bytes = module_id.encode("utf-8")
        source = module_sources[module_id]
        source_bytes = source.encode("utf-8") if isinstance(source, str) else bytes(source)
        digest.update(len(path_bytes).to_bytes(8, "big"))
        digest.update(path_bytes)
        digest.update(hashlib.sha256(source_bytes).digest())
    return digest.hexdigest()


def _export_binding_names(binding):
    """Return the source and exposed names from a parsed export binding."""
    parts = re.split(r"\s+as\s+", binding.strip(), maxsplit=1)
    return parts[0], parts[-1]


def _module_export_names(graph, module_id, memo=None, resolving=None):
    """Resolve the public export names of one module, including export-star edges."""
    memo = {} if memo is None else memo
    resolving = set() if resolving is None else resolving
    if module_id in memo:
        return memo[module_id]
    if module_id in resolving:
        return set()
    paths = {graph.mod_id(path): path for path in graph.order}
    path = paths.get(module_id)
    if path is None:
        raise RuntimeError(f"Public API entry is absent from the module graph: {module_id}")

    resolving.add(module_id)
    try:
        _, exports = parse_module(graph.modules[path])
        names = set()
        for export in exports:
            if export.default:
                names.add("default")
            if export.namespace:
                names.add(export.namespace)
            if not export.reexport:
                names.update(_export_binding_names(name)[1] for name in export.named)
                continue

            target = graph.resolve_import(path, export.spec)
            if target is None or target not in graph.modules:
                raise RuntimeError(
                    f"Public re-export {export.spec!r} from {module_id} is not bundled"
                )
            target_id = graph.mod_id(target)
            target_names = _module_export_names(graph, target_id, memo, resolving)
            if export.named:
                for binding in export.named:
                    source_name, exposed_name = _export_binding_names(binding)
                    if source_name not in target_names:
                        raise RuntimeError(
                            f"Public re-export {source_name!r} from {module_id} "
                            f"is absent from {target_id}"
                        )
                    names.add(exposed_name)
            elif export.namespace is None:
                names.update(name for name in target_names if name != "default")
        memo[module_id] = names
        return names
    except ParseError as error:
        raise RuntimeError(f"Cannot validate public exports in {module_id}: {error}") from error
    finally:
        resolving.remove(module_id)


def _validate_symbol_contracts(graph, contracts, label) -> OrderedDict:
    """Validate named exports for an auditable set of public entry contracts."""
    result = OrderedDict()
    memo = {}
    for subsystem, contract in contracts.items():
        entry = contract["entry"]
        exports = _module_export_names(graph, entry, memo=memo)
        required = tuple(contract["required"])
        missing = sorted(set(required).difference(exports))
        if missing:
            raise RuntimeError(
                f"{subsystem} public API is missing required exports:\n  "
                + "\n  ".join(missing)
            )
        result[subsystem] = {
            "entry": entry,
            "exports": len(exports),
            "required_symbols": list(required),
            "required_symbols_verified": len(required),
        }
        print(
            f"[bundle] {subsystem} {label}: verified "
            f"{len(required)}/{len(required)} required symbol(s)"
        )
    return result


def _validate_platform_public_symbols(graph) -> OrderedDict:
    """Fail unless every consumer-facing subsystem symbol is actually exported."""
    return _validate_symbol_contracts(graph, _PLATFORM_PUBLIC_SYMBOLS, "public API")


def _validate_platform_bootstraps(graph) -> OrderedDict:
    """Fail unless each subsystem's direct boot entry retains its required API."""
    return _validate_symbol_contracts(graph, _PLATFORM_BOOTSTRAP_SYMBOLS, "bootstrap")


def _validate_engine_demo_public_symbols(graph) -> OrderedDict:
    """Fail unless the non-eager engine entry retains the reviewed demo API."""
    return _validate_symbol_contracts(
        graph,
        _ENGINE_DEMO_PUBLIC_SYMBOLS,
        "engine-demo public API",
    )


def _platform_subsystem_manifest(manifest_files, module_sources=None) -> OrderedDict:
    """Build and validate per-subsystem source inventories for the release manifest."""
    files = tuple(manifest_files)
    contracts = _platform_required_modules_by_subsystem()
    result = OrderedDict()
    for subsystem, required in contracts.items():
        prefix = subsystem + "/"
        inventory = tuple(path for path in files if path.startswith(prefix))
        if not inventory:
            raise RuntimeError(f"Platform manifest has no {subsystem} JavaScript modules")
        _validate_required_bundle_modules(
            files,
            required,
            f"{subsystem} subsystem",
        )
        result[subsystem] = {
            "files": len(inventory),
            "inventory_sha256": _inventory_sha256(inventory),
            "required_modules": list(required),
            "required_modules_verified": len(required),
        }
        if module_sources is not None:
            result[subsystem]["source_content_sha256"] = _source_inventory_sha256({
                path: module_sources[path]
                for path in inventory
            })
    return result


def _build_runtime_provenance(manifest, minified_bytes: bytes, gzip_bytes: bytes) -> dict:
    """Build deterministic in-toto/SLSA v1 provenance for the browser runtime."""
    source_digest = manifest.get("source_content_sha256")
    if not re.fullmatch(r"[0-9a-f]{64}", str(source_digest or "")):
        raise RuntimeError("Runtime provenance requires a valid source content SHA-256")
    name = manifest["name"]
    official_inventory = manifest.get("officialPackages") or {}
    official_inventory_sha256 = hashlib.sha256(
        json.dumps(
            official_inventory,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return {
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [
            {
                "name": f"{name}.min.js.gz",
                "digest": {"sha256": hashlib.sha256(gzip_bytes).hexdigest()},
            },
            {
                "name": f"{name}.min.js",
                "digest": {
                    "sha256": hashlib.sha256(minified_bytes).hexdigest(),
                    "sha384": hashlib.sha384(minified_bytes).hexdigest(),
                },
            },
        ],
        "predicateType": "https://slsa.dev/provenance/v1",
        "predicate": {
            "buildDefinition": {
                "buildType": "https://particlerealms.online/buildtypes/python-browser-bundle/v1",
                "externalParameters": {
                    "target": manifest.get("target"),
                    "entries": list(manifest.get("entries") or ()),
                    "production": bool(manifest.get("production")),
                    "eager": bool(manifest.get("eager")),
                    "obfuscate": bool(manifest.get("obfuscate")),
                    "encrypt": bool(manifest.get("encrypt")),
                },
                "internalParameters": {
                    "bundleVersion": manifest.get("version"),
                    "moduleCount": manifest.get("modules"),
                    "fileInventorySha256": manifest.get("file_inventory_sha256"),
                    "officialPackageInventorySha256": official_inventory_sha256,
                    "sdkBuildInputsSha256": manifest.get("sdkBuildInputsSha256"),
                    "buildTools": manifest.get("buildTools"),
                    "buildMode": manifest.get("buildMode"),
                    "signedRegistrySha256": manifest.get("signedRegistrySha256"),
                },
                "resolvedDependencies": [{
                    "uri": "git+https://github.com/BTSpaniel/particlerealms.engine",
                    "digest": {"sha256": source_digest},
                }],
            },
            "runDetails": {
                "builder": {
                    "id": "https://github.com/BTSpaniel/particlerealms.engine/tree/main/bundler"
                },
                "metadata": {"reproducible": True},
            },
        },
    }


def _expected_platform_registry_keys(files, module_id_map):
    """Return the exact emitted registry key for every manifest module."""
    if not isinstance(module_id_map, dict):
        raise RuntimeError("Platform registry verification requires the exact module ID map")
    expected = []
    seen = set()
    for module_id in files:
        compact = module_id_map.get(module_id)
        if compact is None:
            key = module_id
        elif isinstance(compact, (str, int)) and re.fullmatch(r"[0-9]+", str(compact)):
            key = int(compact)
        else:
            raise RuntimeError(f"Platform module ID map is invalid for {module_id}")
        property_key = str(key)
        if property_key in seen:
            raise RuntimeError(f"Platform module ID map duplicates runtime key {property_key}")
        seen.add(property_key)
        expected.append(key)
    return tuple(expected)


def _registry_entry_exports_symbol(registry, runtime, entry_key, symbol) -> bool:
    """Prove an export in its entry wrapper or exact export-star dependency graph."""
    emitted_symbol = "__default" if symbol == "default" else symbol
    pending = [entry_key]
    visited = set()
    while pending:
        key = pending.pop()
        property_key = str(key)
        if property_key in visited:
            continue
        visited.add(property_key)
        try:
            wrapper = registry.wrapper_for(key)
        except KeyError:
            continue
        if wrapper.has_export(runtime, emitted_symbol):
            return True
        pending.extend(wrapper.reexport_keys(runtime))
    return False


def _verify_runtime_release_artifacts(
    manifest,
    expected_files,
    minified_bytes: bytes,
    gzip_artifact,
    module_sources=None,
    module_id_map=None,
) -> dict:
    """Cross-verify a final engine/platform runtime against its manifest.

    This runs after minification and compression, so a transform that drops a
    registry module, corrupts a public namespace, or publishes stale gzip bytes
    fails the build before the manifest or site can be released.
    """
    files = list(manifest.get("files") or [])
    expected = list(expected_files)
    if files != expected:
        missing = sorted(set(expected).difference(files))
        extra = sorted(set(files).difference(expected))
        raise RuntimeError(
            "Runtime manifest/source inventory mismatch"
            f" (missing={missing[:8]}, extra={extra[:8]})"
        )
    if manifest.get("modules") != len(files):
        raise RuntimeError(
            f"Runtime manifest module count {manifest.get('modules')} "
            f"does not match its {len(files)} file records"
        )
    if manifest.get("file_inventory_sha256") != _inventory_sha256(files):
        raise RuntimeError("Runtime manifest file inventory SHA-256 is invalid")
    if module_sources is not None:
        source_content_sha256 = _source_inventory_sha256(module_sources)
        if manifest.get("source_content_sha256") != source_content_sha256:
            raise RuntimeError("Runtime manifest source content SHA-256 is invalid")
    else:
        source_content_sha256 = manifest.get("source_content_sha256")
    expected_namespaces = [
        public_entry_namespace(entry)
        for entry in (manifest.get("entries") or [])[1:]
    ]
    if list(manifest.get("public_namespaces") or []) != expected_namespaces:
        raise RuntimeError(
            "Runtime public namespace manifest does not match its entry points: "
            f"expected {expected_namespaces}, got {manifest.get('public_namespaces')}"
        )

    compressed = (
        bytes(gzip_artifact)
        if isinstance(gzip_artifact, (bytes, bytearray, memoryview))
        else Path(gzip_artifact).read_bytes()
    )
    if len(compressed) != manifest.get("browser_runtime_bytes"):
        raise RuntimeError("Runtime gzip byte count does not match its manifest")
    try:
        decoded = gzip.decompress(compressed)
    except (OSError, EOFError) as error:
        raise RuntimeError(f"Runtime gzip is not decodable: {error}") from error
    if decoded != minified_bytes:
        raise RuntimeError("Runtime gzip expands to different bytes than the minified runtime")
    if len(decoded) != manifest.get("browser_runtime_decoded_bytes"):
        raise RuntimeError("Runtime decoded byte count does not match its manifest")
    integrity = "sha384-" + base64.b64encode(hashlib.sha384(decoded).digest()).decode("ascii")
    if integrity != manifest.get("browser_runtime_integrity") or integrity != manifest.get("sri"):
        raise RuntimeError("Runtime SHA-384 identity does not match its manifest")

    transformed = [
        name
        for name in ("obfuscate", "encrypt", "integrity_wrapper")
        if manifest.get(name)
    ]
    if transformed:
        raise RuntimeError(
            "Runtime release verification cannot prove transformed runtime structure: "
            + ", ".join(transformed)
        )
    static_registry_verified = True
    runtime = decoded.decode("utf-8", errors="strict")
    expected_registry_keys = _expected_platform_registry_keys(files, module_id_map)
    try:
        registry = extract_canonical_module_registry(runtime)
    except ParseError as error:
        raise RuntimeError(f"Final runtime registry is malformed: {error}") from error
    registry_entries = len(registry.wrappers)
    if registry.keys != expected_registry_keys:
        mismatch_index = next(
            (
                index
                for index, pair in enumerate(zip(registry.keys, expected_registry_keys))
                if pair[0] != pair[1]
            ),
            min(len(registry.keys), len(expected_registry_keys)),
        )
        raise RuntimeError(
            "Final runtime registry key inventory does not match the manifest "
            f"at index {mismatch_index} ({registry_entries} wrappers; "
            f"manifest requires {len(files)})"
        )
    outer_tokens = registry.outer_token_values(runtime)
    for namespace in manifest.get("public_namespaces") or []:
        if not contains_token_value_sequence(outer_tokens, ("PE", ".", namespace, "=")):
            raise RuntimeError(f"Final runtime is missing PE.{namespace}")
    for label, sequence in (
        ("PE.requireModule=", ("PE", ".", "requireModule", "=")),
        ("PE.__require=__r", ("PE", ".", "__require", "=", "__r")),
        ("PE.__modules=__modules", ("PE", ".", "__modules", "=", "__modules")),
        ("PE._require=__r", ("PE", ".", "_require", "=", "__r")),
    ):
        if not contains_token_value_sequence(outer_tokens, sequence):
            raise RuntimeError(f"Final runtime is missing registry marker {label}")
    registry_key_by_file = dict(zip(files, expected_registry_keys))
    for contract_group in ("public_api_contracts", "bootstrap_contracts"):
        for subsystem, contract in (manifest.get(contract_group) or {}).items():
            entry = contract.get("entry")
            if entry not in registry_key_by_file:
                raise RuntimeError(
                    f"Final runtime is missing {subsystem} contract entry {entry}"
                )
            for symbol in contract.get("required_symbols") or ():
                if not _registry_entry_exports_symbol(
                    registry,
                    runtime,
                    registry_key_by_file[entry],
                    symbol,
                ):
                    raise RuntimeError(
                        f"Final runtime is missing {subsystem} "
                        f"contract symbol {symbol} from {entry}"
                    )

    report = {
        "format": 1,
        "files_verified": len(files),
        "file_inventory_sha256": _inventory_sha256(files),
        "source_content_sha256": source_content_sha256,
        "decoded_sha384": integrity,
        "gzip_sha256": hashlib.sha256(compressed).hexdigest(),
        "registry_entries": registry_entries,
        "static_registry_verified": static_registry_verified,
        "public_namespaces_verified": list(manifest.get("public_namespaces") or []),
    }
    if manifest.get("target") == "engine":
        engine_demo_contract = (
            manifest.get("public_api_contracts") or {}
        ).get("engine-demo") or {}
        report["engine_demo_public_api_verified"] = len(
            engine_demo_contract.get("required_symbols") or ()
        )
    print(
        "[bundle] Runtime post-build contract: verified "
        f"{len(files)}/{len(files)} files, "
        f"{registry_entries if registry_entries is not None else 'transformed'} registry entries, "
        f"{len(report['public_namespaces_verified'])} public namespace(s), gzip + SHA-384"
    )
    return report


def _verify_platform_release_artifacts(*args, **kwargs) -> dict:
    """Compatibility name for existing verifier tests and integrations."""
    return _verify_runtime_release_artifacts(*args, **kwargs)


def _base_required_deployment_paths(
    site_profile: str | None,
    bundle_name: str,
    include_webgpu_os: bool = False,
) -> list[str]:
    """Return the load-bearing files for a release site's actual root layout."""
    if site_profile == "webgpu-os":
        required_paths = [
            "webgpu-os/index.html",
            f"webgpu-os/assets/{bundle_name}.min.js.gz",
            f"webgpu-os/assets/{bundle_name}.min.js.sri",
            f"webgpu-os/assets/{bundle_name}.manifest.json",
            f"webgpu-os/assets/{bundle_name}.provenance.json",
        ]
    else:
        required_paths = ["index.html"]
    if site_profile == "webgpu-os" or include_webgpu_os:
        required_paths.extend(
            f"webgpu-os/{relative_path}"
            for relative_path in WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS
        )
    required_paths.extend(morphfield_schema_deployment_paths(ROOT))
    return required_paths


def _write_release_compressed_artifacts(
    release_dir: Path,
    bundle_name: str,
    gzip_data: bytes,
    best_ext: str,
    best_data: bytes,
    *,
    supplied_encodings=None,
) -> Path:
    """Publish current encodings, removing alternatives outside the supplied set."""
    encodings = dict(supplied_encodings or {})
    if set(encodings).difference({".gz", ".br", ".zst", ".xz"}):
        raise ValueError("Unsupported release compression encoding")
    for extension, expected in ((".gz", gzip_data), (best_ext, best_data)):
        if extension in encodings and encodings[extension] != expected:
            raise ValueError("Supplied release compression differs from its verified runtime")
        encodings[extension] = expected
    best_path = release_dir / f"{bundle_name}.min.js{best_ext}"
    for extension, payload in encodings.items():
        _write_exact_bytes(release_dir / f"{bundle_name}.min.js{extension}", payload)
    # SDKs explicitly supply every current encoding. Ordinary releases retain
    # gzip plus the selected best format; CDN negotiation must never find an
    # older representation beside those current artifacts.
    for alternate_ext in (".br", ".zst", ".xz"):
        alternate_path = release_dir / f"{bundle_name}.min.js{alternate_ext}"
        if alternate_ext not in encodings:
            alternate_path.unlink(missing_ok=True)
    return best_path


def _publish_verified_runtime_artifacts(
    *,
    writes,
    release_dir: Path,
    bundle_name: str,
    gzip_data: bytes,
    best_ext: str,
    best_data: bytes,
    verify=None,
    preserve_encodings=False,
):
    """Verify first, then publish every runtime representation as one gate."""
    verification_report = verify() if verify is not None else None
    supplied_encodings = {}
    release_encoding_paths = {
        (release_dir / f"{bundle_name}.min.js{extension}").resolve(): extension
        for extension in (".gz", ".br", ".zst", ".xz")
    }
    for path, data in writes:
        extension = release_encoding_paths.get(Path(path).resolve())
        if extension is not None:
            if preserve_encodings:
                if extension in supplied_encodings and supplied_encodings[extension] != data:
                    raise ValueError("Conflicting supplied release compression bytes")
                supplied_encodings[extension] = data
        else:
            _write_exact_bytes(path, data)
    release_best_path = _write_release_compressed_artifacts(
        release_dir,
        bundle_name,
        gzip_data,
        best_ext,
        best_data,
        supplied_encodings=supplied_encodings,
    )
    return verification_report, release_best_path


def _release_compressed_artifacts_are_current(release_dir: Path, bundle_name: str) -> bool:
    """Return whether release compression files agree with their manifest."""
    manifest_path = release_dir / f"{bundle_name}.manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or manifest.get("name") != bundle_name:
            return False
        best_ext = {
            "gzip": ".gz",
            "zopfli": ".gz",
            "brotli": ".br",
            "zstd": ".zst",
            "lzma": ".xz",
        }.get(manifest.get("best_compressed"))
        gzip_size = int(manifest["gzip_bytes"])
        best_size = int(manifest["best_bytes"])
        if best_ext is None or gzip_size < 0 or best_size < 0:
            return False
        sdk_build = manifest.get("buildMode") in {"sdk", "sdk-rebuild", "sdk-stage"}
        part_map = compressed_artifact_part_map(manifest)
        lengths = {f"{bundle_name}.min.js.gz": gzip_size, f"{bundle_name}.min.js{best_ext}": best_size}
        if sdk_build:
            for field, extension in (("gzip_bytes", ".gz"), ("brotli_bytes", ".br"),
                                     ("zstd_bytes", ".zst"), ("lzma_bytes", ".xz")):
                size = manifest[field]
                if type(size) is not int or size < 0:
                    return False
                if size:
                    name = f"{bundle_name}.min.js{extension}"
                    if name in lengths and lengths[name] != size:
                        return False
                    lengths[name] = size
            if gzip_size <= 0 or best_size <= 0:
                return False
        if set(part_map).difference(lengths):
            return False
        payloads = {}
        for logical_name, size in lengths.items():
            whole_path = release_dir / logical_name
            if not sdk_build and whole_path.stat().st_size != size:
                return False
            payload = read_compressed_artifact(
                release_dir, logical_name, manifest,
                expected_bytes=size, prefer_full=logical_name not in part_map,
            )
            if whole_path.is_file() and payload != whole_path.read_bytes():
                return False
            payloads[logical_name] = payload
        for alternate_ext in (".br", ".zst", ".xz"):
            alternate_path = release_dir / f"{bundle_name}.min.js{alternate_ext}"
            if alternate_path.name not in lengths and alternate_path.exists():
                return False
        provenance = manifest.get("provenance")
        if not isinstance(provenance, dict):
            return False
        provenance_path = release_dir / str(provenance.get("path") or "")
        expected_provenance_sha256 = str(provenance.get("sha256") or "")
        if (
            provenance.get("path") != f"{bundle_name}.provenance.json"
            or not re.fullmatch(r"[0-9a-f]{64}", expected_provenance_sha256)
            or hashlib.sha256(provenance_path.read_bytes()).hexdigest()
            != expected_provenance_sha256
        ):
            return False
        if sdk_build:
            compressed = payloads[f"{bundle_name}.min.js.gz"]
            import zlib
            try:
                decoded = gzip.decompress(compressed)
            except (OSError, EOFError, zlib.error):
                return False
            sri = "sha384-" + base64.b64encode(hashlib.sha384(decoded).digest()).decode("ascii")
            if (manifest.get("sri") != sri or manifest.get("browser_runtime_integrity") != sri
                    or manifest.get("browser_runtime_decoded_bytes") != len(decoded)
                    or (release_dir / f"{bundle_name}.min.js.sri").read_text(encoding="utf-8").strip() != sri):
                return False
            proof = json.loads(provenance_path.read_text(encoding="utf-8"))
            if not isinstance(proof, dict) or not isinstance(proof.get("subject"), list):
                return False
            subjects = {}
            for item in proof["subject"]:
                if (not isinstance(item, dict) or not isinstance(item.get("name"), str)
                        or not isinstance(item.get("digest"), dict) or item["name"] in subjects):
                    return False
                subjects[item["name"]] = item["digest"]
            runtime_subject = subjects[f"{bundle_name}.min.js"]
            if (subjects[f"{bundle_name}.min.js.gz"].get("sha256") != hashlib.sha256(compressed).hexdigest()
                    or runtime_subject.get("sha256") != hashlib.sha256(decoded).hexdigest()
                    or runtime_subject.get("sha384") != hashlib.sha384(decoded).hexdigest()):
                return False
            for logical_name, payload in payloads.items():
                extension = Path(logical_name).suffix
                if extension == ".gz":
                    continue
                if extension == ".br":
                    import brotli
                    try:
                        unpacked = brotli.decompress(payload)
                    except brotli.error:
                        return False
                elif extension == ".zst":
                    import zstandard
                    try:
                        unpacked = zstandard.ZstdDecompressor().decompress(payload, max_output_size=len(decoded))
                    except zstandard.ZstdError:
                        return False
                else:
                    try:
                        unpacked = lzma.decompress(payload)
                    except lzma.LZMAError:
                        return False
                if unpacked != decoded:
                    return False
        return True
    except (KeyError, OSError, TypeError, ValueError, ImportError, json.JSONDecodeError):
        return False


def _signed_os_release_requires_fresh_build(args) -> bool:
    """Signed OS releases mint fresh certs and must never reuse stale preambles."""
    return bool(
        getattr(args, "include_webgpu_os", False)
        and (getattr(args, "production", False) or getattr(args, "release", False))
        and not getattr(args, "sdk_rebuild", False)
        and not getattr(args, "stage_dir", None)
    )


def _platform_template_sync_required(args) -> bool:
    """Return whether this build may replace the production-only Template kit."""
    return bool(
        getattr(args, "target", None) == "platform"
        and getattr(args, "production", False)
        and not getattr(args, "dry_run", False)
        and not getattr(args, "sdk_only", False)
        and not getattr(args, "sdk_rebuild", False)
    )


def _platform_site_requires_production(args) -> bool:
    """Reject a deployable platform site that cannot satisfy its runtime kit."""
    return bool(
        getattr(args, "target", None) == "platform"
        and getattr(args, "build_site", False)
        and not getattr(args, "production", False)
        and not getattr(args, "dry_run", False)
    )


def _validate_platform_sdk_configuration(args, entries) -> None:
    """Validate optional Engine UI and the Platform SDK's runtime kit contract."""
    if not getattr(args, "build_sdk", False):
        return
    if getattr(args, "target", None) == "engine":
        if any(getattr(args, flag, False) for flag in ("include_editor", "include_agi", "include_webgpu_os")):
            raise ValueError("Engine SDK supports optional Plauna UI; select platform for Editor, AGI or WebGPU OS")
        if bool(getattr(args, "include_plauna", False)) != ("plauna/index.js" in entries):
            raise ValueError("Engine SDK Plauna configuration requires its canonical public entry point")
        return
    if getattr(args, "target", None) != "platform":
        return
    expected_entries = _ENGINE_DEMO_PLATFORM_ENTRIES if args.sdk_rebuild else _ENGINE_DEMO_PLATFORM_ENTRIES[:-1]
    if not args.production or not args.eager or args.name != "particle-platform" or tuple(entries) != expected_entries:
        raise ValueError(
            "Platform SDK packaging requires --production, eager initialization, "
            "the particle-platform name and the canonical Platform entry points"
        )


def _bundle_manifest_date(build_sdk: bool) -> str:
    """Use the shared deterministic archive timestamp for SDK provenance."""
    from datetime import datetime
    timestamp = datetime(*_release_archive_datetime()) if build_sdk else datetime.now()
    return timestamp.strftime("%Y-%m-%d %H:%M")


def _deployed_bundle_manifest_path(site_root: Path, site_profile: str | None, bundle_name: str) -> Path:
    """Resolve the copied runtime manifest for each supported deployment layout."""
    relative = (
        Path("webgpu-os") / "assets" / f"{bundle_name}.manifest.json"
        if site_profile == "webgpu-os"
        else Path("assets") / f"{bundle_name}.manifest.json"
    )
    return Path(site_root) / relative


def _validate_deployed_official_package_inventory(
    site_root: Path,
    site_profile: str | None,
    bundle_name: str,
    expected_inventory: dict,
) -> int:
    """Verify the deployed target copied the exact reviewed package inventory."""
    manifest_path = _deployed_bundle_manifest_path(site_root, site_profile, bundle_name)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Deployed bundle manifest is unreadable: {manifest_path}") from error
    try:
        count = assert_manifest_official_package_inventory(manifest, expected_inventory)
        verify_official_package_sidecars(manifest.get("officialPackageAssets", []), manifest_path.parent)
        return count
    except (OSError, ValueError) as error:
        raise RuntimeError(f"Deployed bundle manifest failed official package verification: {manifest_path}") from error


_GENERATED_DOC_INPUTS = {
    "docs-bundle.json.gz",
    "git-dates.json",
    "search-index.json",
}


def _release_build_input_digest(root: Path, include_site: bool, include_sdk=False, target="engine") -> str:
    """Hash build recipes and non-module inputs used by the release output.

    The module graph already fingerprints JavaScript source. This covers the
    Python build recipe plus public HTML/CSS/assets that are copied after the
    runtime is compiled. Without it, editing the Playground or site assembler
    can incorrectly hit the runtime cache and leave an old deployment ZIP.
    """
    candidates = [
        root / "bundler",
        root / "release_targets.json",
        root / "engine/core/compute/artifacts",
        root / "engine/sim/physics/runtime-manifest.json",
    ]
    if (root / "engine/sim/physics/runtime-manifest.json").is_file():
        from .physics import physics_release_asset_paths
        candidates.extend(root / path for path in physics_release_asset_paths(root))
    if (root / "engine/core/compute/ComputeWorker.js").is_file():
        from .wasm import compute_release_asset_paths
        from .compute_contracts import compute_contract_asset_paths
        candidates.extend(root / path for path in compute_release_asset_paths(root))
        candidates.extend(root / path for path in compute_contract_asset_paths(root))
    if include_site:
        tests_dir = root / "tests"
        candidates.extend(tests_dir / item for item in RELEASE_INCLUDE)
        candidates.extend([
            tests_dir / "common" / name for name in RELEASE_COMMON_FILES
        ])
        candidates.extend([
            tests_dir / "functions",
            tests_dir / "network" / "mesh-test.html",
            root / "MD",
            root / "editor" / "index.html",
            root / "editor" / "css",
            root / "plauna" / "motion",
            root / "plauna" / "styles" / "plauna.css",
            root / "engine" / "render" / "morphfield" / "schemas",
            root / "engine" / "sim" / "particles" / "SnapshotWorker.js",
            root / "engine" / "sim" / "physics" / "physx-pe.wasm",
            root / "webgpu-os" / "index.html",
            root / "webgpu-os" / "style.css",
            root / "webgpu-os" / "boot-theme.js",
            root / "webgpu-os" / "sw.js",
            root / PARTICLE_VOICE_LAB_PATH,
            root / PARTICLE_VOICE_WORKLET_PATH,
        ])
        if (root / PARTICLE_VOICE_LAB_PATH).is_file():
            # The lab and AudioWorklet execute raw ESM outside the runtime
            # registry. Their full sidecar closure must invalidate site ZIPs
            # even when no compiled application module changed.
            candidates.extend(root / relative for relative in particle_voice_release_asset_paths(root))
        candidates.extend(
            root / source_name
            for source_name, _ in ENGINE_DEMO_RUNTIME_ASSET_COPIES
        )
        candidates.append(
            root / "Template" / "assets" / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
        )
        candidates.extend(
            release_site_static_asset_source(root, root / "release", relative_path)
            for relative_path in release_site_static_asset_paths(root, require_v3=False)
            if relative_path != "code-metrics.json"
        )

    files = set()
    missing = []
    for candidate in candidates:
        if candidate.is_file():
            files.add(candidate)
        elif candidate.is_dir():
            for path in candidate.rglob("*"):
                if not path.is_file():
                    continue
                if "__pycache__" in path.parts or path.suffix in {".pyc", ".pem"}:
                    continue
                if path.parent.name == "_config" and path.name in _GENERATED_DOC_INPUTS:
                    continue
                files.add(path)
        else:
            missing.append(candidate)

    digest = hashlib.sha256()
    for path in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix().encode("utf-8")
        payload = path.read_bytes()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    for path in sorted(missing, key=lambda item: item.as_posix()):
        digest.update(b"missing\0")
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
    if include_sdk:
        from .sdk import sdk_input_digest
        digest.update(sdk_input_digest(root, target).encode("ascii"))
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Bundle Particle Engine v2 into a single runtime", allow_abbrev=False)
    parser.add_argument("--entry", nargs='+', default=[DEFAULT_ENTRY],
                        help="One or more entry points relative to project root. "
                             "First is primary (exposed as PE.*), rest get namespaced. "
                             "Example: --entry engine/EngineBootstrap.js editor/js/EditorApp.js")
    parser.add_argument("--name", default=DEFAULT_NAME, help="Output filename without extension")
    parser.add_argument("--outdir", default=str(DEFAULT_OUTPUT_DIR), help="Output directory")
    parser.add_argument("--target", default=None,
                        help="Named release target from release_targets.json. "
                             "Defaults to that file's defaultTarget when present.")
    parser.add_argument("--targets-config", default=str(DEFAULT_TARGETS_CONFIG),
                        help="Path to release target configuration JSON.")
    parser.add_argument("--include-agi", action="store_true",
                        help="Append the AGI public API entrypoint to the bundle.")
    parser.add_argument("--include-plauna", action="store_true",
                        help="Append the Plauna public API entrypoint to the bundle.")
    parser.add_argument("--include-webgpu-os", action="store_true",
                        help="Append the WebGPU OS public API entrypoint to the bundle.")
    parser.add_argument("--embed-source-tree", action="store_true",
                        help="Compatibility-only: embed __OS_SOURCE_FILES__ in WebGPU OS builds. "
                             "Disabled by default because it duplicates packaged application source.")
    parser.add_argument("--include-editor", action="store_true",
                        help="Mark this build as including editor/platform APIs in metadata.")
    parser.add_argument("--site-profile", default=None,
                        help="Site profile metadata label for release manifests.")
    parser.add_argument("--no-site", dest="build_site", action="store_false",
                        help="Skip copying public site pages to release/site/.")
    # ``None`` distinguishes no CLI preference from explicit ``--no-site`` so
    # a target default cannot accidentally turn site copying back on.
    parser.set_defaults(build_site=None)
    parser.add_argument("--build-sdk", action="store_true",
                        help="Build the verified source and runtime SDK (engine or platform).")
    parser.add_argument("--sdk-only", action="store_true",
                        help="Build an SDK and verified runtime artifacts without a website or implicit Template sync.")
    parser.add_argument("--sdk-no-archive", action="store_true",
                        help="Publish the verified SDK directory without creating an SDK ZIP.")
    parser.add_argument("--stage-dir", type=Path,
                        help="Build a canonical --production --sdk-only candidate into a fresh isolated directory.")
    parser.add_argument("--sdk-rebuild", action="store_true",
                        help="Rebuild an extracted SDK offline into build/runtime and build/<profile>-sdk.")
    parser.add_argument("--sdk-packages", type=Path,
                        help="Explicit authorized replacement public registry for a Platform SDK rebuild.")
    parser.add_argument("--stats",    action="store_true", help="Print module list")
    parser.add_argument("--dry-run",  action="store_true", help="Scan only, no write")
    parser.add_argument("--gen-dict", action="store_true",
                        help="Train a Zstd dictionary from module sources and write "
                             "release/<name>.dict (CDT-ready for Chrome 130+)")
    parser.add_argument("--ns-order", action="store_true",
                        help="Reorder modules by namespace prefix (Kahn BFS) before "
                             "bundling to improve LZ77 compression locality")
    parser.add_argument("--eager", action="store_true",
                        help="Force-initialize ALL modules at load time (nothing lazy). "
                             "Guarantees entire library is in memory immediately.")
    parser.add_argument("--production", action="store_true",
                        help="Production optimizations: strip console.debug, "
                             "minify HTML inside template literals.")
    parser.add_argument("--release", action="store_true",
                        help="Release build: max-quality compression (zopfli, "
                             "brotli q11, zstd 22). ~4x slower, <1%% smaller. "
                             "Default is fast mode.")
    parser.add_argument("--extreme", action="store_true",
                        help="Use LZMA PRESET_EXTREME (very slow, info-only). "
                             "Only meaningful with --release.")
    parser.add_argument("--obfuscate", action="store_true",
                        help="Obfuscate: string array extraction + base64, "
                             "hex number literals. Runs after minification.")
    parser.add_argument("--encrypt", action="store_true",
                        help="AES-256-GCM encrypt the bundle. Output is a "
                             "self-decrypting loader using Web Crypto API. "
                             "Includes anti-debug + console disable.")
    parser.add_argument("--domain-lock", type=str, default=None,
                        help="Comma-separated domain whitelist. Bundle refuses "
                             "to execute on other domains. "
                             "Example: --domain-lock particlerealms.online,localhost")
    parser.add_argument("--integrity", action="store_true",
                        help="Inject chunked integrity map: SHA-256 hash every "
                             "64KB chunk, HMAC-sign the map. Runtime self-verifies "
                             "via SubtleCrypto. Detects per-chunk tampering.")
    parser.add_argument("--no-cache", action="store_true",
                        help="Disable incremental build cache (always rebuild).")
    parser.add_argument(
        "--sync-consumer",
        action="append",
        default=[],
        metavar="PATH",
        help="After a successful platform build, install the verified runtime, "
             "loader, manifest, integrity, and cache token into PATH. Repeatable. "
             "Production platform builds synchronize the repository Template "
             "automatically; development builds retain its verified production kit.",
    )
    parser.add_argument(
        "--sync-consumer-assets-only",
        action="append",
        default=[],
        metavar="PATH",
        help="After a successful platform build, install verified runtime assets "
             "and sidecars into PATH without changing its HTML or requiring a "
             "configured runtime loader. Repeatable; intended for source-driven tests.",
    )
    parser.add_argument("--gen-roots", type=int, default=0, metavar="N",
                        help="Ring-0 trust keygen: generate N ECDSA P-256 root keypairs, "
                             "bake the PUBLIC roots into webgpu-os/kernel/trust/roots.json, "
                             "and write PRIVATE keys to .trust-keys/ (kept OUT of the bundle). "
                             "Requires the 'cryptography' package. Does not build the bundle.")
    parser.add_argument("--issue-cert", action="store_true",
                        help="Issue a publisher certificate signed by a ring-0 root, so packages "
                             "from that publisher verify as TRUSTED. Needs --cert-pubkey + --cert-subject.")
    parser.add_argument("--cert-pubkey", type=str, default=None,
                        help="Publisher's raw P-256 public key (base64) — from the OS "
                             "'Show publisher key' action. Used with --issue-cert.")
    parser.add_argument("--cert-subject", type=str, default=None,
                        help="Publisher subject name for the issued cert (e.g. your name/org).")
    parser.add_argument("--cert-root", type=str, default=None,
                        help="Root id to sign with (default: first root in roots.json).")
    parser.add_argument("--cert-out", type=str, default=None,
                        help="Output path for the issued .prcert.json (default: .trust-keys/<subject>.prcert.json).")
    args = parser.parse_args()

    # Validate standalone rebuild routing before maintenance commands or writes.
    rebuild_state = None
    sdk_snapshot = None
    stage_root = stage_inputs = stage_snapshot = None
    if args.stage_dir is not None:
        from .staging import validate_stage_arguments, resolve_stage_destination
        try:
            validate_stage_arguments(args, sys.argv[1:])
            stage_root = resolve_stage_destination(ROOT, args.stage_dir)
        except ValueError as error:
            parser.error(str(error))
    if args.sdk_packages is not None and not args.sdk_rebuild:
        parser.error('--sdk-packages requires --sdk-rebuild')
    if args.sdk_rebuild:
        forbidden = {"--outdir", "--name", "--entry", "--targets-config", "--sync-consumer",
                     "--sync-consumer-assets-only", "--gen-roots", "--issue-cert", "--gen-dict",
                     "--include-agi", "--include-plauna", "--include-editor", "--include-webgpu-os",
                     "--obfuscate", "--encrypt", "--domain-lock", "--integrity", "--embed-source-tree"}
        conflicts = sorted({argument.split("=", 1)[0] for argument in sys.argv[1:]} & forbidden)
        if conflicts:
            parser.error("--sdk-rebuild conflicts with " + ", ".join(conflicts))
        try:
            descriptor = json.loads((ROOT / "sdk-build.json").read_text(encoding="utf-8"))
            if args.target is None:
                args.target = descriptor["target"]
        except (OSError, ValueError, KeyError) as error:
            print(f"[bundle] ERROR: SDK build descriptor is unreadable: {error}")
            return 2
        args.production = True
        args.outdir = str(ROOT / "build/runtime")
    if args.sdk_only or args.sdk_rebuild:
        args.build_sdk = True
        args.build_site = False

    # Legacy bundle protections are deprecated as security controls.
    # --integrity is replaced by SHA-384 SRI on the production loader.
    # --domain-lock and --encrypt are obfuscation helpers, not execution controls.
    if args.integrity:
        print("[bundle] WARNING: --integrity is deprecated; SHA-384 SRI is generated for production builds instead.")
    if args.domain_lock:
        print("[bundle] WARNING: --domain-lock is deprecated as a security control; it only injects a runtime hostname check.")
    if args.encrypt:
        print("[bundle] WARNING: --encrypt is deprecated as a security control; it is obfuscation, not secrecy.")

    # Ring-0 trust keygen is a standalone maintenance step — run and exit.
    if getattr(args, "gen_roots", 0):
        return generate_ring0_roots(args.gen_roots)

    # Publisher certificate issuance — standalone maintenance step — run and exit.
    if getattr(args, "issue_cert", False):
        return issue_publisher_cert(args.cert_pubkey, args.cert_subject, args.cert_root, args.cert_out)

    try:
        entries, target_config = resolve_bundle_configuration(args)
    except ValueError as error:
        print(f"[bundle] ERROR: {error}")
        return 2
    if args.sdk_no_archive and not args.build_sdk:
        parser.error('--sdk-no-archive requires SDK packaging (--build-sdk, --sdk-only or --sdk-rebuild)')
    if stage_root is not None:
        from .staging import validate_stage_configuration
        try:
            validate_stage_configuration(args, entries)
        except ValueError as error:
            parser.error(str(error))
        args.outdir = str(stage_root / 'runtime')
    if args.build_sdk:
        if args.target not in {"engine", "platform"} or args.obfuscate or args.encrypt or args.domain_lock or args.integrity or args.embed_source_tree or args.gen_dict:
            print("[bundle] ERROR: SDK packaging requires an unwrapped engine or platform runtime without embedded sources or dictionaries")
            return 2
        primary = {'engine': 'engine/EngineBootstrap.js', 'platform': 'engine/EngineEditorBootstrap.js'}[args.target]
        if entries[0] != primary or (args.target == 'engine' and any((args.include_editor, args.include_agi, args.include_webgpu_os))):
            print('[bundle] ERROR: SDK profiles require their canonical primary API; Engine supports optional Plauna UI, while Editor, AGI and WebGPU OS require platform')
            return 2
        try:
            from .sdk_rebuild import _verify_tools, sdk_tool_versions
            _verify_tools(sdk_tool_versions())
        except ValueError as error:
            print(f'[bundle] ERROR: SDK tool preflight failed: {error}')
            return 2
        from . import builder
        # The shipped dependency lock uses one explicit minifier backend.
        global HAS_ESBUILD
        builder.HAS_ESBUILD = HAS_ESBUILD = False
    if args.sdk_rebuild:
        try:
            from .sdk_rebuild import prepare_sdk_rebuild
            replacement = args.sdk_packages.read_bytes() if args.sdk_packages is not None else None
            rebuild_state = prepare_sdk_rebuild(ROOT, args.target, supplied_registry=replacement)
            configuration = rebuild_state['descriptor'].get('runtime')
            if configuration:
                explicit_flags = {argument.split('=', 1)[0] for argument in sys.argv[1:]}
                for flag, field in (('--production', 'production'), ('--eager', 'eager'),
                                    ('--release', 'release'), ('--extreme', 'extreme'), ('--ns-order', 'ns_ordered')):
                    if flag in explicit_flags and not configuration[field]:
                        raise ValueError(f'{flag} conflicts with the SDK recorded runtime configuration')
                entries = list(configuration['entries'])
                for field in ('name', 'production', 'eager', 'release', 'extreme', 'include_editor',
                              'include_agi', 'include_plauna', 'include_webgpu_os', 'site_profile', 'base_url_root'):
                    setattr(args, field, configuration[field])
                args.ns_order = configuration['ns_ordered']
        except (OSError, ValueError, RuntimeError, KeyError, TypeError) as error:
            print(f"[bundle] ERROR: SDK rebuild preflight failed: {error}")
            return 2
    try:
        _validate_platform_sdk_configuration(args, entries)
        sdk_manifest_date = _bundle_manifest_date(True) if args.build_sdk else None
    except ValueError as error:
        print(f"[bundle] ERROR: SDK configuration preflight failed: {error}")
        return 2
    if _platform_site_requires_production(args):
        print(
            "[bundle] ERROR: Platform site builds publish a byte-identical "
            "production engine-demo runtime; rerun with --production or use "
            "--no-site for a development-only bundle."
        )
        return 2

    # Source and emitted Wasm share one provenance gate before the JS cache.
    # Dry runs verify only; regular builds compile missing/stale variants.
    try:
        if stage_root is not None:
            from .staging import verify_stage_inputs
            from .sdk import sdk_input_snapshot
            stage_inputs = verify_stage_inputs(ROOT, args.target)
            stage_snapshot = sdk_input_snapshot(ROOT, args.target)
        from .wasm import build_compute_kernels, compute_release_asset_paths
        from .compute_contracts import verify_compute_contracts, compute_contract_asset_paths
        verify_compute_contracts(ROOT)
        compute_build = build_compute_kernels(ROOT, check=bool(args.dry_run or args.sdk_rebuild or stage_root is not None))
        verify_compute_contracts(ROOT, manifest=compute_build['manifest'])
        print(f"[bundle] Compute kernels: {'verified' if compute_build['cached'] else 'rebuilt'} four ABI 1 variants")
    except (OSError, ValueError, RuntimeError) as error:
        print(f"[bundle] ERROR: {error}")
        return 1

    # Development fallbacks are graph inputs, so their exact signed revision
    # must be made current before ModuleGraph reads any JavaScript. Production
    # and release builds never mutate shared source fallbacks; they mint a fresh
    # verified registry preamble later and bypass cross-target cache reuse.
    if getattr(args, "include_webgpu_os", False) and not args.sdk_rebuild and stage_root is None:
        if args.production or args.release:
            print("[official] release mode preserves checked-in development Faculty fallbacks")
            try:
                fallback_state = verify_development_faculty_fallbacks(ROOT)
                print(
                    "[official] development Faculty fallbacks: verified current "
                    f"({len(fallback_state['records'])} records; release read-only)"
                )
            except RuntimeError as error:
                print(
                    "[bundle] ERROR: release requires current checked-in development "
                    f"Faculty fallbacks: {error}"
                )
                return 1
        elif args.dry_run:
            try:
                fallback_state = verify_development_faculty_fallbacks(ROOT)
                print(
                    "[official] development Faculty fallbacks: verified current "
                    f"({len(fallback_state['records'])} records; dry run)"
                )
            except RuntimeError as error:
                print(f"[official] development Faculty fallbacks require refresh after dry run: {error}")
        else:
            try:
                fallback_state = prepare_development_faculty_fallbacks(ROOT)
                action = "atomically refreshed" if fallback_state["refreshed"] else "verified and reused"
                print(
                    f"[official] development Faculty fallbacks: {action} "
                    f"({len(fallback_state['records'])} records)"
                )
            except RuntimeError as error:
                print(f"[bundle] ERROR: {error}")
                return 1

    # Compile-in WebGPU OS apps + mods: generate a static barrel that imports
    # every app/mod entry so they end up IN the bundle (not runtime-fetched).
    _generated_barrel = None
    _generated_barrel_source = None
    _source_preamble  = None
    _official_preamble = None
    _official_container_assets = {}
    _official_container_inventory = []
    _official_package_inventory = {
        "format": OFFICIAL_PACKAGE_INVENTORY_FORMAT,
        "packages": [],
    }
    if getattr(args, "include_webgpu_os", False):
        _generated_barrel_source = render_webgpu_os_app_barrel(ROOT)
        if _generated_barrel_source:
            _generated_barrel = WEBGPU_OS_BARREL_REL
            entries.append(_generated_barrel)
    elif args.build_site:
        # The engine site includes the Playground. Compile only its shared
        # material widget closure, without importing the RealmForge app/session.
        # Platform builds already reach this widget through compiled OS apps.
        entries.extend(_required_playground_runtime_entries(ROOT))
    # Final guard: never walk the same entry twice (e.g. webgpu-os/index.js as
    # both primary and include, or a duplicate barrel append).
    entries = dedupe_preserve_order(entries)

    print(f"[bundle] Particle Engine v{ENGINE_VERSION} Runtime Bundler")
    print(f"[bundle] Root:  {ROOT}")
    if args.target:
        label = target_config.get("label", args.target) if target_config else args.target
        print(f"[bundle] Target: {args.target} ({label})")
    for i, e in enumerate(entries):
        label = "Primary" if i == 0 else f"Entry {i+1}"
        print(f"[bundle] {label}: {e}")
    if args.include_agi:
        print("[bundle] Include: AGI")
    if args.include_plauna:
        print("[bundle] Include: Plauna")
    if args.include_webgpu_os:
        print("[bundle] Include: WebGPU OS")
    if args.include_editor:
        print("[bundle] Include: Editor metadata")
    if args.eager:
        print(f"[bundle] Mode: EAGER (all modules force-initialized)")
    if args.production:
        print(f"[bundle] Mode: PRODUCTION (console stripping + byte-exact templates)")
    if args.release:
        print(f"[bundle] Mode: RELEASE (max-quality compression)")
    else:
        print(f"[bundle] Mode: FAST (default — lower compression, skip zopfli)")
    if args.obfuscate:
        print(f"[bundle] Mode: OBFUSCATE (string array + base64, hex numbers)")
    if args.encrypt:
        print(f"[bundle] Mode: ENCRYPT (AES-256-GCM + anti-debug + console disable)")
    if args.domain_lock:
        print(f"[bundle] Mode: DOMAIN LOCK ({args.domain_lock})")
    if args.integrity:
        print(f"[bundle] Mode: INTEGRITY (chunked SHA-256 + HMAC verification)")
    print()

    import time as _time
    _t0 = _time.perf_counter()
    _timings = []
    def _lap(label):
        nonlocal _t0
        elapsed = _time.perf_counter() - _t0
        _timings.append((label, elapsed))
        _t0 = _time.perf_counter()

    # Load the cyclic dependency baseline (if present) so only NEW cycles
    # are fatal. Missing or empty baseline means all cycles are errors.
    cyclic_baseline = []
    cyclic_baseline_path = ROOT / "bundler" / "cyclic_baseline.json"
    if cyclic_baseline_path.is_file():
        try:
            cyclic_baseline = load_cyclic_baseline(cyclic_baseline_path)
        except Exception as e:
            print(f"[bundle] WARNING: could not load cyclic baseline: {e}")

    if args.build_sdk:
        if not args.sdk_rebuild and not args.dry_run and stage_root is None:
            from .site import _prepare_md_docs
            _prepare_md_docs(ROOT)
    graph = ModuleGraph(ROOT, SKIP_PATTERNS, cyclic_baseline=cyclic_baseline)
    for entry in entries:
        if entry == _generated_barrel and _generated_barrel_source is not None:
            graph.walk_source(entry, _generated_barrel_source)
        else:
            graph.walk(entry)
    _lap('Graph walk (read files + parse imports)')

    if graph.cycles:
        print(f"[bundle] {len(graph.cycles)} cyclic module dependencies detected")
        for cycle in graph.cycles[:10]:
            print(f"  - {' -> '.join(graph.mod_id(p) for p in cycle)}")
        if len(graph.cycles) > 10:
            print(f"  ... and {len(graph.cycles) - 10} more")

    if graph.errors:
        print(f"[bundle] {len(graph.errors)} fatal error(s):")
        for e in graph.errors[:10]:
            print(f"  - {e}")
        print()
        return 1

    if args.build_sdk:
        from .sdk import sdk_input_snapshot
        if stage_snapshot is not None:
            from .sdk import _verify_snapshot
            try:
                _verify_snapshot(ROOT, stage_snapshot)
            except (OSError, ValueError) as error:
                print(f'[bundle] ERROR: SDK staging inputs changed during graph assembly: {error}')
                return 1
        sdk_snapshot = sdk_input_snapshot(
            ROOT, args.target, [graph.mod_id(path) for path in graph.order]
        )

    print(f"[bundle] {graph.stats['files']} modules ({graph.stats['total_bytes']:,} bytes source)")
    print(f"[bundle] {graph.stats['skipped']} skipped")
    if args.build_site and args.site_profile != "webgpu-os":
        _validate_required_bundle_modules(
            [graph.mod_id(path) for path in graph.order],
            _required_playground_runtime_entries(ROOT),
            "Playground shared widgets",
        )

    # Repository telemetry covers all maintained first-party source, not only
    # modules reachable from this target. Generate it before the cache gate so
    # a cached bundle still reports an up-to-date audit.
    code_metrics = collect_code_metrics(ROOT)
    metrics_files = code_metrics["totals"]["files"]
    metrics_lines = code_metrics["totals"]["lines"]
    print(f"[bundle] Repository metrics: {metrics_files:,} first-party files, "
          f"{metrics_lines:,} physical lines")
    outdir = Path(args.outdir)
    release_dir = stage_root / 'runtime' if stage_root is not None else ROOT / "build/runtime" if args.sdk_rebuild else ROOT / "release"
    if not args.dry_run:
        if stage_root is not None:
            # Revalidate immediately before claiming a destination. A failed
            # preflight never creates output, and another writer cannot be reused.
            if resolve_stage_destination(ROOT, args.stage_dir) != stage_root:
                raise ValueError('SDK staging destination changed after preflight')
            stage_root.mkdir(parents=True, exist_ok=False)
        metrics_paths = {
            outdir.resolve() / "code-metrics.json",
            release_dir / "code-metrics.json",
        }
        if not args.sdk_rebuild and stage_root is None:
            metrics_paths.add(ROOT / "tests" / "assets" / "code-metrics.json")
        for metrics_path in metrics_paths:
            write_code_metrics(metrics_path, code_metrics)

    # -- Incremental build cache: skip rebuild if source hash unchanged --
    cache_path = stage_root / '.cache' / '.build_cache.v2' if stage_root is not None else release_dir / ".build_cache.v2"
    digest = None
    if not args.no_cache and not args.dry_run:
        source_hash = hashlib.sha256()
        for fp in graph.order:
            source_hash.update(graph.modules[fp].encode("utf-8"))
        metrics_digest_input = dict(code_metrics)
        metrics_digest_input.pop("generated_at", None)
        source_hash.update(json.dumps(metrics_digest_input, sort_keys=True).encode("utf-8"))
        source_hash.update(_release_build_input_digest(ROOT, args.build_site).encode("ascii"))
        if sdk_snapshot:
            source_hash.update(sdk_snapshot['sha256'].encode("ascii"))
        if rebuild_state and rebuild_state['official_preamble'] is not None:
            source_hash.update(rebuild_state['official_preamble'].encode('utf-8'))
        # Include the resolved target and every output-shaping flag so different
        # targets/modes can never collide in the shared cache record.
        flag_str = (f"target={args.target},name={args.name},entries={','.join(entries)},"
                    f"site={args.build_site},profile={args.site_profile},sdk={args.build_sdk},sdkArchive={not args.sdk_no_archive},"
                    f"editor={args.include_editor},agi={args.include_agi},"
                    f"plauna={args.include_plauna},os={args.include_webgpu_os},"
                    f"eager={args.eager},prod={args.production},release={args.release},"
                    f"extreme={args.extreme},dict={args.gen_dict},ns={args.ns_order},"
                    f"obf={args.obfuscate},enc={args.encrypt},dl={args.domain_lock},"
                    f"int={args.integrity},source={args.embed_source_tree}")
        source_hash.update(flag_str.encode())
        digest = source_hash.hexdigest()

        out_min = outdir / f"{args.name}.min.js"
        expected_outputs = [out_min]
        if args.build_site:
            expected_outputs.extend([
                release_dir / f"{args.name}-site.zip",
                release_dir / "site" / "index.html",
            ])
        release_artifacts_current = _release_compressed_artifacts_are_current(release_dir, args.name)
        sdk_current = True
        if args.build_sdk:
            from .sdk import sdk_is_current
            sdk_destination = stage_root / (args.target + '-sdk') if stage_root is not None else ROOT / "build" / (args.target + "-sdk") if args.sdk_rebuild else release_dir / (args.target + "-sdk")
            sdk_current = sdk_is_current(sdk_destination, args.target, create_archive=not args.sdk_no_archive)
        signed_os_release = _signed_os_release_requires_fresh_build(args)
        if (not signed_os_release
                and cache_path.is_file()
                and release_artifacts_current
                and sdk_current
                and all(path.is_file() for path in expected_outputs)):
            cached = cache_path.read_text(encoding="utf-8").strip()
            if cached == digest:
                elapsed = _time.perf_counter() - _t0 + sum(t for _, t in _timings)
                print(f"[bundle] No source changes detected -- skipping rebuild ({elapsed:.2f}s)")
                print(f"[bundle] Use --no-cache to force rebuild")
                return
        elif signed_os_release:
            print("[bundle] Signed WebGPU OS release requires fresh package evidence -- cache bypassed")
        # Will save digest at end of successful build

    if args.stats:
        print()
        for fp in graph.order:
            mid = graph.mod_id(fp)
            size = len(graph.modules[fp].encode("utf-8"))
            print(f"  {size:>8,} B  {mid}")

    if args.dry_run:
        print("\n[bundle] Dry run complete")
        return

    if getattr(args, "include_webgpu_os", False):
        if args.embed_source_tree:
            _source_preamble = generate_system_source_barrel(ROOT)
        # Official signed packages remain the production application payload.
        try:
            public_inputs = stage_inputs if stage_root is not None else rebuild_state
            if public_inputs is not None:
                _official_container_assets.update(public_inputs['official_container_assets'])
            _official_preamble = public_inputs['official_preamble'] if public_inputs is not None else build_official_app_packages(
                ROOT,
                write_generated_fallback=False,
                required=bool(args.production or args.release),
                # The platform's signed engine-demo kit retains its exact-file
                # contract. Only the standalone OS target externalizes payloads.
                container_assets=_official_container_assets if args.target == "webgpu-os" else None,
            )
            if _official_preamble:
                if args.build_sdk:
                    from .sdk_rebuild import _registry_bytes
                    from .official_inventory import OFFICIAL_PACKAGE_ASSIGNMENT
                    registry_bytes, _records = _registry_bytes(_official_preamble)
                    _official_preamble = OFFICIAL_PACKAGE_ASSIGNMENT + registry_bytes.decode('utf-8') + ';'
                _official_package_inventory = official_package_inventory_from_source(
                    _official_preamble
                )
                _official_container_inventory = official_package_sidecar_inventory(
                    extract_official_package_records(_official_preamble)
                )
                print(
                    "[bundle] Official package inventory: verified "
                    f"{len(_official_package_inventory['packages'])} embedded record(s)"
                )
        except (RuntimeError, ValueError) as error:
            print(f"[bundle] ERROR: {error}")
            return 1

    outdir.mkdir(parents=True, exist_ok=True)

    # Release folder at project root
    release_dir.mkdir(parents=True, exist_ok=True)

    # -- Optional: namespace-grouped module ordering --
    if args.ns_order:
        print("[bundle] Reordering modules by namespace (Kahn BFS)...")
        graph.reorder_by_namespace()
        print(f"[bundle] Module order updated ({len(graph.order)} modules)")

    # Resolve entry module IDs for multi-entry public API
    entry_ids = []
    for entry in entries:
        entry_path = str((ROOT / entry).resolve())
        if entry_path in graph.modules:
            entry_ids.append(graph.mod_id(entry_path))
        else:
            print(f"[bundle] WARNING: entry '{entry}' not found in graph, skipping")
    if not entry_ids:
        print(f"[bundle] ERROR: no valid entries")
        return

    os_base_prefix = getattr(args, "base_url_root", None)
    if os_base_prefix:
        print(f"[bundle] OS base prefix: {os_base_prefix} (import.meta.url anchored to __PE_OS_BASE__||document.baseURI)")
    print(f"[bundle] Building bundle ({len(entry_ids)} entries, eager={args.eager})...")
    bundle = build_bundle(graph, ROOT, entry_ids=entry_ids, eager=args.eager, os_base_prefix=os_base_prefix)
    # Prepend the source-tree IIFE so __OS_SOURCE_FILES__ is set before any
    # module registry code runs. Done here (after build_bundle) so the preamble
    # travels through minification/compression alongside the rest of the bundle.
    if getattr(args, 'include_webgpu_os', False) and _source_preamble:
        bundle = _source_preamble + '\n' + bundle
        print(f"[bundle] Source tree preamble prepended ({fmt_size(len(_source_preamble.encode()))})")
    # Official signed app packages (set before any module runs, like the source tree).
    if getattr(args, 'include_webgpu_os', False) and _official_preamble:
        bundle = _official_preamble + '\n' + bundle
        assert_official_package_inventory_matches_source(
            bundle,
            _official_package_inventory,
        )
        print(f"[bundle] Official packages preamble prepended ({fmt_size(len(_official_preamble.encode()))})")
    print("[bundle] Validating classic-script syntax...")
    assert_classic_script_compatible(bundle, label=f"{args.name}.js")
    print("[bundle] Classic-script syntax: passed (0 executable import.meta expressions)")
    _lap('Build bundle (concatenate + rewrite imports/exports)')

    out_js = outdir / f"{args.name}.js"
    bundle_bytes = bundle.encode("utf-8")
    js_size = len(bundle_bytes)
    print(f"[bundle] {out_js.name}: {fmt_size(js_size)}")

    # -- Module ID shortening: replace long path strings with numeric IDs --
    print("[bundle] Shortening module IDs...")
    # SDK registries are signed build inputs. Even whitespace and property
    # order are retained, including explicitly supplied replacement packages.
    # The unminified representation already includes this same exact prefix.
    protected_registry = _official_preamble if args.build_sdk else ''
    optimization_source = bundle[len(protected_registry) + 1:] if protected_registry else bundle
    bundle_opt, id_map = shorten_module_ids(optimization_source)
    id_savings = len(optimization_source.encode("utf-8")) - len(bundle_opt.encode("utf-8"))
    print(f"[bundle] ID shortening: {len(id_map)} IDs, saved {fmt_size(id_savings)}")

    # Keep internal helper names lexical until an AST-scoped renamer can prove
    # that signed records and application strings remain byte-exact.
    bundle_opt = shorten_bundle_internals(bundle_opt)
    short_size = len(bundle_opt.encode("utf-8"))
    total_pre_savings = len(optimization_source.encode("utf-8")) - short_size
    print(f"[bundle] Pre-minify safe savings total: {fmt_size(total_pre_savings)}")
    _lap('ID shortening + literal-safe internals')

    _min_engine = "esbuild" if HAS_ESBUILD else ("rjsmin/C" if HAS_RJSMIN else "JSMin/Python")
    print(f"[bundle] Minifying ({_min_engine})...")
    minified = minify_source(bundle_opt)
    _lap(f'Minification ({_min_engine})')

    # -- Production optimizations (run AFTER JSMin so comments are gone) --
    if args.production:
        pre_prod_size = len(minified.encode("utf-8"))

        print("[bundle] Production: stripping console.debug...")
        minified, console_saved = strip_console_calls(minified)
        print(f"[bundle] Console stripping: saved {fmt_size(console_saved)}")

        print("[bundle] Production: preserving HTML template literals byte-exact...")
        minified, html_saved = minify_html_in_template_literals(minified)
        print(f"[bundle] HTML template preservation: saved {fmt_size(html_saved)}")

        post_prod_size = len(minified.encode("utf-8"))
        prod_total = pre_prod_size - post_prod_size
        print(f"[bundle] Production total: saved {fmt_size(prod_total)} "
              f"({prod_total/pre_prod_size*100:.1f}% of minified)")
        _lap('Production passes (console strip + template preservation)')

    if protected_registry:
        minified = _prepend_sdk_official_registry(minified, protected_registry)
        print("[bundle] SDK official registry: original UTF-8 bytes preserved")
    if _official_preamble:
        embedded_package_count = assert_official_package_inventory_matches_source(
            minified,
            _official_package_inventory,
        )
        print(
            "[bundle] Minified official package inventory: verified "
            f"{embedded_package_count} embedded record(s)"
        )

    # -- Obfuscation (runs after minification + production passes) --
    if args.obfuscate:
        pre_obf_size = len(minified.encode("utf-8"))

        print("[bundle] Obfuscating: converting numbers to hex...")
        minified, hex_count = obfuscate_hex_numbers(minified)
        print(f"[bundle] Hex numbers: {hex_count} literals converted")

        print("[bundle] Obfuscating: extracting strings to base64 array...")
        minified, str_count = obfuscate_strings(minified)
        print(f"[bundle] String array: {str_count} unique strings extracted")

        post_obf_size = len(minified.encode("utf-8"))
        obf_growth = post_obf_size - pre_obf_size
        print(f"[bundle] Obfuscation overhead: +{fmt_size(obf_growth)} "
              f"({obf_growth/pre_obf_size*100:.1f}%)")
        _lap('Obfuscation (string array + hex numbers)')

    # -- Encryption (wraps the entire bundle in AES-256-GCM loader) --
    if args.encrypt:
        print("[bundle] Validating plaintext runtime syntax before encryption...")
        assert_browser_classic_script_syntax(
            minified,
            label=f"{args.name}.min.js plaintext",
        )
        print("[bundle] Plaintext runtime syntax: passed")
        _lap('Pre-encryption Chromium syntax validation')

        domains = [d.strip() for d in args.domain_lock.split(',')] if args.domain_lock else None
        pre_enc_size = len(minified.encode("utf-8"))

        print("[bundle] Encrypting: AES-256-GCM + anti-debug + integrity...")
        if domains:
            print(f"[bundle] Domain lock: {', '.join(domains)}")
        minified = encrypt_bundle(minified, domains=domains)

        post_enc_size = len(minified.encode("utf-8"))
        # base64 expands ~33%, but GCM adds only 16 bytes auth tag
        print(f"[bundle] Encrypted loader: {fmt_size(post_enc_size)} "
              f"(+{(post_enc_size/pre_enc_size - 1)*100:.0f}% from base64 encoding)")
        _lap('Encryption (AES-256-GCM wrapper)')
    elif args.domain_lock:
        # Domain lock without encryption: inject a simple hostname check prefix
        domains = [d.strip() for d in args.domain_lock.split(',')]
        domains_json = json.dumps(domains)
        domain_prefix = (
            f'(function(){{var _h=location.hostname;var _dl={domains_json};'
            f'if(!_dl.some(function(d){{return _h===d||_h.endsWith("."+d)}})){{return}}'
            f'}})();'
        )
        minified = domain_prefix + minified
        print(f"[bundle] Domain lock injected: {', '.join(domains)}")
        _lap('Domain lock injection')

    # -- Integrity Map (runs LAST, wraps everything in verification header) --
    if args.integrity:
        pre_int_size = len(minified.encode("utf-8"))
        chunk_kb = 64
        print(f"[bundle] Integrity: building {chunk_kb}KB chunked SHA-256 + HMAC map...")
        minified, num_chunks = build_integrity_wrapper(minified, chunk_size=chunk_kb * 1024)
        post_int_size = len(minified.encode("utf-8"))
        overhead = post_int_size - pre_int_size
        print(f"[bundle] Integrity map: {num_chunks} chunks verified, "
              f"+{fmt_size(overhead)} header overhead")
        _lap('Integrity map (chunked SHA-256 + HMAC)')

    print("[bundle] Validating final transformed runtime syntax in Chromium...")
    assert_browser_classic_script_syntax(minified, label=f"{args.name}.min.js")
    print("[bundle] Final transformed runtime syntax: passed")
    _lap('Final Chromium syntax validation')

    # Hold every final runtime representation in memory until the complete
    # platform truth gate has accepted the transformed bytes. Publishing here
    # used to leave a new runtime beside an old manifest whenever that gate
    # rejected a build.
    out_min = outdir / f"{args.name}.min.js"
    min_bytes = minified.encode("utf-8")
    min_size = len(min_bytes)
    print(f"[bundle] {out_min.name}: {fmt_size(min_size)}")

    # SHA-384 SRI for the production loader (replaces legacy --integrity)
    sri_hash = "sha384-" + base64.b64encode(hashlib.sha384(min_bytes).digest()).decode()
    out_sri = outdir / f"{args.name}.min.js.sri"
    rel_sri = release_dir / f"{args.name}.min.js.sri"
    print(f"[bundle] SRI: {sri_hash[:24]}…")

    src_bytes = max(graph.stats['total_bytes'], 1)

    # -- Compression levels --
    # Default: fast mode (~12s).  --release: max quality (~30s), <1% smaller.
    if args.release:
        gz_level     = 9
        zopfli_iters = 5        # was 15 — 3x faster, <0.3% larger
        br_quality   = 11
        zstd_level   = 22
        lzma_extreme = args.extreme
    else:
        gz_level     = 6
        zopfli_iters = 0        # skip entirely
        br_quality   = 5
        zstd_level   = 10
        lzma_extreme = False

    skip_zopfli = (not args.release) or not HAS_ZOPFLI
    formats = ["gzip"]
    if not skip_zopfli: formats.append("zopfli")
    if HAS_BROTLI: formats.append("brotli")
    if HAS_ZSTD:   formats.append("zstd")
    formats.append("lzma")
    print(f"[bundle] Compressing (parallel: {', '.join(formats)}"
          + ("" if args.release else " [FAST]") + ")...")

    # -- Optional: CDT delta compression (--gen-dict) --
    prev_dict_bytes = None
    dcz_data        = None
    dcz_size        = None
    prev_dict_path  = release_dir / f"{args.name}.dict"
    if args.gen_dict and HAS_ZSTD:
        if prev_dict_path.is_file():
            prev_dict_bytes = prev_dict_path.read_bytes()
            print(f"[bundle] CDT: compressing against previous dict ({fmt_size(len(prev_dict_bytes))})...")
            dcz_data = compress_dcz(min_bytes, prev_dict_bytes, level=zstd_level)
            dcz_size = len(dcz_data) if dcz_data else None
        else:
            print("[bundle] CDT: no previous dict found — will create on first run")

    # Native codecs release the GIL. Small inputs avoid process startup and
    # serialization; large inputs retain the measured platform execution path.
    compression_executor = (
        ThreadPoolExecutor if min_size <= SMALL_COMPRESSION_INPUT_BYTES else ProcessPoolExecutor
    )
    print(f"[bundle] Compression executor: {compression_executor.__name__} ({fmt_size(min_size)} input)")
    with compression_executor(max_workers=5) as pool:
        gz_fut     = pool.submit(compress_gzip,   min_bytes, gz_level)
        zopfli_fut = pool.submit(compress_zopfli,  min_bytes, zopfli_iters) if not skip_zopfli else None
        br_fut     = pool.submit(compress_brotli,  min_bytes, br_quality)   if HAS_BROTLI else None
        zstd_fut   = pool.submit(compress_zstd,    min_bytes, zstd_level)   if HAS_ZSTD   else None
        lzma_fut   = pool.submit(compress_lzma,    min_bytes, lzma_extreme)

    gz_data    = gz_fut.result()
    gz_size    = len(gz_data)
    zopfli_data = zopfli_fut.result() if zopfli_fut else None
    zopfli_size = len(zopfli_data)    if zopfli_data else None
    br_data    = br_fut.result()   if br_fut   else None
    br_size    = len(br_data)      if br_data  else None
    zstd_data  = zstd_fut.result() if zstd_fut else None
    zstd_size  = len(zstd_data)   if zstd_data else None
    lzma_data  = lzma_fut.result()
    lzma_size  = len(lzma_data)
    _lap('Compression (all formats parallel)')

    # --- Pick best browser-deliverable format ---
    # Priority: zstd > brotli > zopfli > gzip  (smallest wins within each tier)
    candidates = [("gzip", ".gz", gz_data, gz_size)]
    if zopfli_data and zopfli_size < gz_size:
        candidates.append(("zopfli", ".gz", zopfli_data, zopfli_size))
    if br_data:
        candidates.append(("brotli", ".br", br_data, br_size))
    if zstd_data:
        candidates.append(("zstd", ".zst", zstd_data, zstd_size))
    candidates.sort(key=lambda x: x[3])
    best_name, best_ext, best_data, best_size = candidates[0]
    # Use gzip-compat for .gz even if zopfli won (same extension, same decompression)
    # If zopfli won over plain gzip, upgrade the .gz file silently
    gz_out_data = zopfli_data if (zopfli_data and zopfli_size < gz_size) else gz_data
    gz_out_size = zopfli_size if (zopfli_data and zopfli_size < gz_size) else gz_size
    gz_out_label = "zopfli" if (zopfli_data and zopfli_size < gz_size) else "gzip"

    best_reduction = (1 - best_size / src_bytes) * 100
    reduction_pct  = (1 - min_size  / src_bytes) * 100
    gz_reduction   = (1 - gz_out_size / src_bytes) * 100

    # Resolve publication paths now, but do not replace any prior artifact
    # until post-build verification has accepted the in-memory runtime.
    out_gz = outdir / f"{args.name}.min.js.gz"
    if br_data:
        out_br = outdir / f"{args.name}.min.js.br"
    if zstd_data:
        out_zst = outdir / f"{args.name}.min.js.zst"
    if dcz_data:
        out_dcz = outdir / f"{args.name}.min.js.dcz"

    manifest = {
        "format": "particle-bundle-manifest/v2",
        "schema_version": 2,
        "name": args.name,
        "version": ENGINE_VERSION,
        "date": sdk_manifest_date if args.build_sdk else _bundle_manifest_date(False),
        "entries": entries,
        "public_namespaces": [public_entry_namespace(entry) for entry in entries[1:]],
        "target": args.target,
        "site_profile": args.site_profile,
        "include_editor": args.include_editor,
        "include_agi": args.include_agi,
        "include_plauna": args.include_plauna,
        "include_webgpu_os": args.include_webgpu_os,
        "embed_source_tree": args.embed_source_tree,
        "eager": args.eager,
        "production": args.production,
        "release": args.release,
        "extreme": bool(args.extreme and args.release),
        "base_url_root": args.base_url_root,
        "obfuscate": args.obfuscate,
        "encrypt": args.encrypt,
        "integrity_wrapper": args.integrity,
        "modules": graph.stats["files"],
        "module_ids": len(id_map),
        "ns_ordered": args.ns_order,
        "source_bytes": graph.stats["total_bytes"],
        "bundle_bytes": js_size,
        "min_bytes": min_size,
        "gzip_bytes": gz_out_size,
        "gzip_method": gz_out_label,
        "brotli_bytes": br_size,
        "zstd_bytes": zstd_size,
        "lzma_bytes": lzma_size,
        "zstd_dict_bytes": dcz_size,
        "dcz_header_bytes": DCZ_HEADER_LEN if dcz_size else None,
        "dcz_dictionary_sha256": hashlib.sha256(prev_dict_bytes).hexdigest() if dcz_size else None,
        "best_compressed": best_name,
        "best_bytes": best_size,
        "repository_metrics": "code-metrics.json",
        "repository": code_metrics["totals"],
        "sri": sri_hash,
        "browser_runtime": f"{args.name}.min.js.gz",
        "browser_runtime_compression": "gzip",
        "browser_runtime_bytes": gz_out_size,
        "browser_runtime_decoded_bytes": min_size,
        "browser_runtime_integrity": sri_hash,
        "browser_runtime_loader": "release-runtime-loader.js",
        "reduction_min":  f"{reduction_pct:.1f}%",
        "reduction_gzip": f"{gz_reduction:.1f}%",
        "reduction_best": f"{best_reduction:.1f}%",
        "files": [graph.mod_id(fp) for fp in graph.order],
        "officialPackages": _official_package_inventory,
        "officialPackageAssets": _official_container_inventory,
    }
    if sdk_snapshot:
        from .sdk_rebuild import sdk_tool_versions
        manifest['sdkBuildInputsSha256'] = sdk_snapshot['sha256']
        manifest['buildTools'] = sdk_tool_versions()
        manifest['buildMode'] = 'sdk-stage' if stage_root is not None else 'sdk-rebuild' if args.sdk_rebuild else 'sdk'
        if _official_preamble:
            manifest['signedRegistrySha256'] = hashlib.sha256(
                _official_preamble.encode('utf-8')
            ).hexdigest()
    # Transport parts preserve the complete compressed artifact and runtime
    # identity while keeping each deployed file within the hosting limit.
    compressed_part_files = {}
    compressed_parts = {}
    for logical_name, payload in {
        f"{args.name}.min.js.gz": gz_out_data,
        f"{args.name}.min.js{best_ext}": best_data,
    }.items():
        records, files = plan_compressed_artifact_parts(
            logical_name, payload, max_file_bytes=CLOUDFLARE_PAGES_MAX_FILE_BYTES,
        )
        if records:
            compressed_parts[logical_name] = records
            compressed_part_files.update(files)
            print(f"[bundle] Shared runtime transport: {logical_name} -> {len(records)} verified part(s)")
    if compressed_parts:
        manifest["compressed_artifact_parts"] = compressed_parts
    manifest["file_inventory_sha256"] = _inventory_sha256(manifest["files"])
    module_sources = {
        graph.mod_id(path): graph.modules[path]
        for path in graph.order
    }
    manifest["source_content_sha256"] = _source_inventory_sha256(module_sources)
    if "engine/EngineBootstrap.js" in manifest["files"]:
        _validate_required_bundle_modules(
            manifest["files"],
            _required_engine_public_module_paths(),
            "Engine public surface",
        )
    if args.target == "platform":
        _validate_required_bundle_modules(
            manifest["files"],
            _required_platform_public_module_paths(),
            "Platform public roots",
        )
        manifest["public_namespaces"] = list(_PLATFORM_PUBLIC_NAMESPACES)
        manifest["subsystems"] = _platform_subsystem_manifest(
            manifest["files"],
            module_sources,
        )
        manifest["public_api_contracts"] = _validate_platform_public_symbols(graph)
        manifest["bootstrap_contracts"] = _validate_platform_bootstraps(graph)
    elif args.target == "engine":
        manifest["public_api_contracts"] = _validate_engine_demo_public_symbols(graph)
    if args.include_webgpu_os:
        _validate_required_bundle_modules(
            manifest["files"],
            _required_ai_echo_module_paths(ROOT),
            "AI Echo",
        )
    verification_action = None
    if args.target in {"engine", "platform"}:
        verification_action = lambda: _verify_runtime_release_artifacts(
            manifest,
            [graph.mod_id(fp) for fp in graph.order],
            min_bytes,
            gz_out_data,
            module_sources,
            id_map,
        )

    # The transformed runtime, required gzip identity, optional encodings, and
    # SRI share one publication boundary after final-artifact verification.
    runtime_writes = [
        (out_js, bundle_bytes),
        (out_min, min_bytes),
        (out_sri, sri_hash.encode("utf-8")),
        (rel_sri, sri_hash.encode("utf-8")),
        (out_gz, gz_out_data),
    ]
    for name, data in compressed_part_files.items():
        runtime_writes.extend([(outdir / name, data), (release_dir / name, data)])
    # Content-addressed package bytes share the runtime publication boundary.
    # No built runtime may reference a sidecar omitted from either consumer tree.
    for path, data in _official_container_assets.items():
        runtime_writes[0:0] = [(outdir / path, data), (release_dir / path, data)]
    compute_paths = tuple(sorted(set(compute_release_asset_paths(ROOT)) | set(compute_contract_asset_paths(ROOT))))
    manifest["computeAssets"] = []
    for path in compute_paths:
        data = (ROOT / path).read_bytes()
        manifest["computeAssets"].append({"path": path, "sha256": hashlib.sha256(data).hexdigest(), "byteLength": len(data)})
        runtime_writes[0:0] = [(outdir / path, data), (release_dir / path, data)]
    from .physics import physics_asset_records, audit_physics_consumers
    manifest['physicsConsumerAudit'] = audit_physics_consumers(ROOT)
    manifest["physicsAssets"] = physics_asset_records(ROOT)
    for item in manifest["physicsAssets"]:
        path = item["path"]
        data = (ROOT / path).read_bytes()
        runtime_writes[0:0] = [(outdir / path, data), (release_dir / path, data)]
    if br_data:
        runtime_writes.extend([(out_br, br_data), (release_dir / out_br.name, br_data)])
    if zstd_data:
        runtime_writes.extend([(out_zst, zstd_data), (release_dir / out_zst.name, zstd_data)])
    if args.build_sdk:
        runtime_writes.append((release_dir / f'{args.name}.min.js.xz', lzma_data))
    if dcz_data:
        runtime_writes.append((out_dcz, dcz_data))
    if args.gen_dict and HAS_ZSTD:
        runtime_writes.append((prev_dict_path, min_bytes))

    # Network acceptance and older HTTP hosts bind/use the gzip path even when
    # Brotli or Zstd is the smallest representation. The shared gate also keeps
    # those release encodings untouched when verification rejects a candidate.
    verification_report, rel_compressed = _publish_verified_runtime_artifacts(
        writes=runtime_writes,
        release_dir=release_dir,
        bundle_name=args.name,
        gzip_data=gz_out_data,
        best_ext=best_ext,
        best_data=best_data,
        verify=verification_action,
        preserve_encodings=args.build_sdk,
    )
    if verification_report is not None:
        manifest["post_build_verification"] = verification_report
    if args.gen_dict and HAS_ZSTD:
        print(f"[bundle] CDT dict saved: {prev_dict_path.name} ({fmt_size(len(min_bytes))})")
    provenance = _build_runtime_provenance(manifest, min_bytes, gz_out_data)
    provenance_bytes = (json.dumps(provenance, indent=2) + "\n").encode("utf-8")
    provenance_name = f"{args.name}.provenance.json"
    manifest["provenance"] = {
        "path": provenance_name,
        "predicate_type": provenance["predicateType"],
        "sha256": hashlib.sha256(provenance_bytes).hexdigest(),
    }
    _write_exact_bytes(outdir / provenance_name, provenance_bytes)
    _write_exact_bytes(release_dir / provenance_name, provenance_bytes)
    manifest_path = outdir / f"{args.name}.manifest.json"
    _write_exact_utf8(manifest_path, json.dumps(manifest, indent=2) + "\n")

    # Also copy manifest to release
    rel_manifest = release_dir / f"{args.name}.manifest.json"
    _write_exact_utf8(rel_manifest, json.dumps(manifest, indent=2) + "\n")

    # A production platform site packages the Template-owned engine-demo kit,
    # so bind Template to that exact verified runtime before site staging.
    # Development-only --no-site builds retain the last verified production
    # kit. User-supplied consumers remain post-publish.
    synchronized = set()
    if args.target == "platform":
        template_root = ROOT / "Template"
        if _platform_template_sync_required(args):
            synchronized.add(str(template_root.resolve()).casefold())
            receipt = sync_release_runtime_consumer(
                template_root,
                release_dir,
                manifest,
                os_base="./",
                update_bootstrap=True,
                engine_demo_root=ROOT,
            )
            _print_runtime_consumer_receipt(receipt)
        else:
            print(
                "[bundle] Template runtime sync: retained verified production kit "
                "(no implicit synchronization requested for this build)"
            )

    if args.build_sdk:
        from .sdk import build_engine_sdk
        build_engine_sdk(ROOT, release_dir, manifest,
            module_sources=module_sources,
            raw_module_sources={graph.mod_id(path): source for path, source in graph.raw_modules.items()},
            output_dir=stage_root / (args.target + '-sdk') if stage_root is not None else ROOT / 'build' / (args.target + '-sdk') if args.sdk_rebuild else None,
            official_records=_official_preamble, input_snapshot=sdk_snapshot, runtime_dir=outdir,
            create_archive=not args.sdk_no_archive)

    # -- Copy public site pages to release/site/ --
    if not args.build_site:
        site_count, site_size = 0, 0
        print("\n[bundle] Site copy skipped (--no-site).")
    elif args.site_profile == "webgpu-os":
        print("\n[bundle] Building WebGPU OS site (raw apps/mods + bundled core asset)...")
        site_count, site_size = copy_webgpu_os_site(
            ROOT,
            release_dir,
            graph,
            args.name,
            best_ext,
            bundle_assets_dir=outdir,
        )
    else:
        print("\n[bundle] Copying site pages to release/site/...")
        site_count, site_size = copy_release_site(ROOT, release_dir, args.name, best_ext,
                                                  include_os=bool(getattr(args, "include_webgpu_os", False)))
    if args.build_site:
        print(f"[bundle] Copied {site_count} files ({fmt_size(site_size)})")
        if _official_preamble:
            deployed_package_count = _validate_deployed_official_package_inventory(
                release_dir / "site",
                args.site_profile,
                args.name,
                _official_package_inventory,
            )
            print(
                "[bundle] Deployed official package inventory: verified "
                f"{deployed_package_count} record(s)"
            )
        archive_path = release_dir / f"{args.name}-site.zip"
        required_deploy_paths = _base_required_deployment_paths(
            args.site_profile,
            args.name,
            include_webgpu_os=bool(getattr(args, "include_webgpu_os", False)),
        )
        if args.site_profile != "webgpu-os":
            required_deploy_paths.extend([
                f"assets/{args.name}.min.js{best_ext}",
                f"assets/{args.name}.min.js.gz",
                f"assets/{args.name}.min.js.sri",
                f"assets/{args.name}.manifest.json",
                f"assets/{args.name}.provenance.json",
                "assets/release-runtime-loader.js",
                "editor/release-boot.js",
                "editor/js/loader-guard.js",
                "morphfield/index.html",
                "playground/index.html",
                "playground/src/main.js",
                "playground/src/registry.js",
                "playground/src/demos/manifest.js",
                "playground/src/demos/morphField.js",
            ])
            required_deploy_paths.extend(
                f"assets/{relative_path}"
                for relative_path in release_site_static_asset_paths(ROOT)
            )
            playground_paths = _required_playground_deployment_paths(ROOT)
            required_deploy_paths.extend(playground_paths)
            print(
                f"[bundle] Playground: enforcing {len(playground_paths)} "
                "source file(s) in the deployment archive"
            )
            required_morphfield_modules = {
                "engine/render/morphfield/index.js",
                "engine/render/morphfield/assets/MorphAssetCodec.js",
                "engine/render/morphfield/runtime/MorphFieldRenderer.js",
                "engine/render/morphfield/runtime/wavefront/MorphFieldWavefrontPathTracer.js",
            }
            missing_morphfield_modules = sorted(
                required_morphfield_modules.difference(manifest.get("files", ()))
            )
            if missing_morphfield_modules:
                raise RuntimeError(
                    "Platform bundle is missing required MorphField modules:\n  "
                    + "\n  ".join(missing_morphfield_modules)
                )
        required_deploy_paths.extend(compute_paths)
        required_deploy_paths = [
            (Path(relative).parent / physical).as_posix()
            for relative in required_deploy_paths
            for physical in (
                compressed_artifact_paths(manifest, Path(relative).name)
                if Path(relative).name in compressed_parts else (Path(relative).name,)
            )
        ]
        from .site_compaction import compact_release_site, promote_compact_release_site
        upload_dir = compact_release_site(ROOT, release_dir / "site", release_dir / "site-upload")
        archive_count, archive_size = create_release_site_archive(
            upload_dir,
            archive_path,
            required_paths=required_deploy_paths,
        )
        print(
            f"[bundle] Site ZIP: {archive_path.name} "
            f"({archive_count} files, {fmt_size(archive_size)}, deterministic + CRC verified)"
        )
        promote_compact_release_site(
            release_dir / "site",
            upload_dir,
            release_dir / "site-full",
        )
    if args.target == "platform":
        for consumer_root, assets_only in (
            [(Path(path), False) for path in args.sync_consumer]
            + [(Path(path), True) for path in args.sync_consumer_assets_only]
        ):
            identity = str(Path(consumer_root).resolve()).casefold()
            if identity in synchronized:
                continue
            receipt = sync_release_runtime_consumer(
                consumer_root,
                release_dir,
                manifest,
                assets_only=assets_only,
            )
            synchronized.add(identity)
            _print_runtime_consumer_receipt(receipt)
    _lap('Copy site files')

    # -- Save incremental cache digest --
    if not args.no_cache and digest is not None:
        try:
            _write_exact_utf8(cache_path, digest + "\n")
        except Exception:
            pass

    if stage_root is not None:
        from .staging import complete_stage
        try:
            complete_stage(ROOT, stage_root, args, manifest, sdk_snapshot, stage_inputs)
        except (OSError, ValueError, RuntimeError) as error:
            print(f'[bundle] ERROR: SDK candidate verification failed: {error}')
            return 1

    # -- Print timing profile --
    total_t = sum(t for _, t in _timings)
    print(f"\n[bundle] Build profile ({total_t:.2f}s total):")
    for label, t in _timings:
        pct = t / total_t * 100
        bar = '#' * int(pct / 2)
        print(f"  {t:6.2f}s  {pct:5.1f}%  {bar}  {label}")

    print(f"\n[bundle] Release -> {release_dir}")
    print(f"  {rel_compressed.name}  ({best_name})")
    print(f"  {rel_manifest.name}")
    print(f"  {provenance_name}  (in-toto / SLSA provenance)")
    print("  code-metrics.json")
    if args.build_site:
        print(f"  site/  (compact Cloudflare upload tree; {args.site_profile} layout)")
        runtime_prefix = "webgpu-os/assets" if args.site_profile == "webgpu-os" else "assets"
        for runtime_file in compressed_artifact_paths(manifest, manifest["browser_runtime"]):
            print(f"  site runtime: {runtime_prefix}/{runtime_file}")
        print(f"  {archive_path.name}  (self-contained website deploy ZIP)")
        print("  site-upload/  (byte-identical compact upload mirror)")
        print(f"  site-full/  ({site_count} source copies; full diagnostic tree)")

    print(f"\n[bundle] Done!")
    print(f"  Source:       {fmt_size(graph.stats['total_bytes']):>12}  ({graph.stats['files']} files)")
    print(f"  Repository:   {metrics_lines:>12,}  physical lines ({metrics_files:,} first-party files)")
    print(f"  ID-shortened: {fmt_size(short_size):>12}  (saved {fmt_size(id_savings)} from {len(id_map)} module IDs)")
    print(f"  Minified:     {fmt_size(min_size):>12}  ({reduction_pct:.1f}% smaller than source)")
    print(f"  -------------------------------------------------------")
    print(f"  Gzip ({gz_out_label:<6}): {fmt_size(gz_out_size):>12}  ({gz_reduction:.1f}% smaller than source)")
    if br_size:
        br_reduction = (1 - br_size / src_bytes) * 100
        print(f"  Brotli:       {fmt_size(br_size):>12}  ({br_reduction:.1f}% smaller than source)")
    if zstd_size:
        zstd_reduction = (1 - zstd_size / src_bytes) * 100
        print(f"  Zstd:         {fmt_size(zstd_size):>12}  ({zstd_reduction:.1f}% smaller than source)  [Chrome 123+]")
    print(f"  LZMA (info):  {fmt_size(lzma_size):>12}  ({(1-lzma_size/src_bytes)*100:.1f}% smaller -- theoretical min)")
    if dcz_size:
        dcz_reduction = (1 - dcz_size / src_bytes) * 100
        print(f"  Zstd-delta (CDT): {fmt_size(dcz_size):>12}  ({dcz_reduction:.1f}% smaller)  "
              f"[delta vs prev build | CDT Chrome 130+]")
    print(f"  -------------------------------------------------------")
    print(f"  Release:      {fmt_size(best_size):>12}  ({best_name}, {best_reduction:.1f}% from source)")
    # Install hints for missing optional compressors
    missing = []
    if not HAS_BROTLI:  missing.append("pip install brotli    # +brotli output")
    if not HAS_ZSTD:    missing.append("pip install zstandard # +zstd output (Chrome 123+)")
    if not HAS_ZOPFLI:  missing.append("pip install zopfli    # +5-8% better gzip")
    if missing:
        print(f"\n[bundle] Optional compressors (install to enable):")
        for hint in missing:
            print(f"  {hint}")

    # -- CDT summary --
    if args.gen_dict and HAS_ZSTD:
        print(f"\n[bundle] CDT (Compression Dictionary Transport — Chrome 130+)")
        print(f"  Dictionary:   {fmt_size(len(min_bytes))} saved as {prev_dict_path.name}")
        if dcz_size:
            saving = min_size - dcz_size
            print(f"  Delta size:   {fmt_size(dcz_size)}  (vs {fmt_size(min_size)} full — saves {fmt_size(saving)} per update)")
        else:
            print(f"  Delta size:   (run again after next build to see delta)")
        print(f"")
        print(f"  Nginx dictionary response (serve over HTTPS):")
        print(f"    location /{args.name}.dict {{")
        print(f"      default_type application/octet-stream;")
        print(f"      add_header Use-As-Dictionary 'match=\"/{args.name}.min.js\"';")
        print(f"      add_header Cache-Control 'public, max-age=31536000, immutable';")
        print(f"    }}")
        print(f"    location = /{args.name}.min.js.dcz {{")
        print(f"      default_type application/javascript;")
        print(f"      add_header Content-Encoding dcz;")
        print(f"      add_header Vary 'Accept-Encoding, Available-Dictionary';")
        print(f"      add_header Link '</{args.name}.dict>;rel=compression-dictionary';")
        print(f"    }}")
        print(f"  # Select .dcz only when Accept-Encoding includes dcz and")
        print(f"  # Available-Dictionary matches dcz_dictionary_sha256 in the manifest;")
        print(f"  # otherwise serve the normal gzip/Brotli/Zstandard representation.")
    elif args.gen_dict and not HAS_ZSTD:
        print(f"\n[bundle] --gen-dict requires: pip install zstandard")


if __name__ == "__main__":
    main()
