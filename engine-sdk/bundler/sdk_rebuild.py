# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Public-only, fail-closed rebuild inputs for extracted Engine/Platform SDKs."""

from __future__ import annotations

import base64
import hashlib
import importlib.metadata
import json
import platform
import re
import sys
import zlib
from pathlib import Path, PurePosixPath

from .official_inventory import OFFICIAL_PACKAGE_ASSIGNMENT, official_container_descriptor
from .signing import (
    _expected_faculty_revision_projection, _faculty_revision_projection,
    _load_ring0_roots, collect_official_app_inputs, verify_official_package_records,
)
from .wasm import verify_compute_artifacts

SDK_BUILD_FORMAT = "particle-sdk-build/v1"
SDK_BUILD_FILENAME = "sdk-build.json"
SDK_REGISTRY_FILENAME = "sdk-official-packages.json"
SDK_PRIMARY_ENTRIES = {"engine": "engine/EngineBootstrap.js", "platform": "engine/EngineEditorBootstrap.js"}
SDK_GENERATED_ENTRIES = {"webgpu-os/.bundled-os-content.generated.js"}
REQUIRED_TOOL_PINS = {
    "jsonschema": "4.25.1", "cryptography": "46.0.5", "rjsmin": "1.2.5",
    "attrs": "25.4.0", "referencing": "0.37.0", "rpds-py": "0.30.0",
    "jsonschema-specifications": "2025.9.1", "cffi": "2.0.0", "pycparser": "3.0",
    "typing-extensions": "4.15.0",
}
COMPRESSION_TOOLS = ("brotli", "zstandard", "zopfli")
FACULTY_INPUT_PATHS = (
    "webgpu-os/apps/ai-echo/AgentToolset.js",
    "webgpu-os/apps/ai-echo/ImageGenerationIdentity.js",
    "webgpu-os/kernel/ToolDriver.js",
    "webgpu-os/kernel/navi/builtins/ArtifactStudioFaculty.js",
    "webgpu-os/kernel/navi/builtins/ArtifactStudioDescriptorHashes.json",
    "webgpu-os/kernel/navi/builtins/BrowserSemanticFaculty.js",
    "webgpu-os/kernel/navi/builtins/BrowserSemanticDescriptorHashes.json",
    "webgpu-os/kernel/navi/builtins/BuiltInToolFaculties.js",
    "webgpu-os/kernel/navi/builtins/BuiltInToolDescriptorHashes.json",
)


def sdk_tool_versions():
    """Describe the actual Python backend; rebuilding never discovers esbuild."""
    versions = {}
    for package in (*REQUIRED_TOOL_PINS, *COMPRESSION_TOOLS):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    return {"python": platform.python_version(), "minifier": "rjsmin", "packages": versions,
            "nativeCompression": {"zlib": {"compiled": zlib.ZLIB_VERSION, "runtime": zlib.ZLIB_RUNTIME_VERSION},
                                  "lzma": "python-stdlib-lzma2-xz"}}


def _safe_path(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError(f"SDK input path must be canonical relative POSIX text: {relative!r}")
    path = PurePosixPath(relative)
    if (path.is_absolute() or ":" in relative or any(part in {".", "..", ".trust-keys", ".git"} for part in path.parts)
            or path.as_posix() != relative or path.suffix.lower() == ".pem"):
        raise ValueError(f"SDK input path is unsafe: {relative}")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root) or (root / relative).is_symlink():
        raise ValueError(f"SDK input escapes its root: {relative}")
    return resolved


def _record(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _validate_records(root, records, *, compare=True):
    if not isinstance(records, dict) or not records:
        raise ValueError("SDK build file records must be a non-empty object")
    for relative, record in records.items():
        path = _safe_path(root, relative)
        if (not isinstance(record, dict) or set(record) != {"bytes", "sha256"}
                or type(record["bytes"]) is not int or record["bytes"] < 0
                or not isinstance(record["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", record["sha256"])):
            raise ValueError(f"Invalid SDK input record: {relative}")
        if not path.is_file():
            raise ValueError(f"Missing SDK build input: {relative}")
        if compare and _record(path) != record:
            raise ValueError(f"SDK immutable input hash/length mismatch: {relative}")


def _immutable_path(relative):
    path = PurePosixPath(relative)
    return (path.parts[0] in {"bundler", "jhc"} or path.suffix in {".py", ".wasm"}
            or relative.startswith("sdk/public_tests/")
            or relative in {"bundle_engine.py", "release_targets.json", "requirements-sdk.txt",
                            "webgpu-os/kernel/trust/roots.json"}
            or relative.startswith("engine/core/compute/artifacts/")
            or relative.startswith("engine/sim/physics/")
            or ("baseline" in path.name and path.suffix == ".json")
            or path.suffix in {".dict", ".zdict"})


def _json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key in SDK public registry: {key}")
        result[key] = value
    return result


def _registry_bytes(official_records):
    if isinstance(official_records, dict):
        raw = json.dumps(official_records, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    elif isinstance(official_records, (str, bytes)):
        raw = official_records.encode("utf-8") if isinstance(official_records, str) else official_records
        source = raw.decode("utf-8")
        # Production signer output includes a leading comment. Accept only
        # complete comments and whitespace before an assignment, never code.
        prefix_end = re.match(r"(?:\s+|//[^\r\n]*(?:\r\n|\r|\n)|/\*[\s\S]*?\*/)*", source).end()
        stripped = source[prefix_end:]
        if stripped.startswith(OFFICIAL_PACKAGE_ASSIGNMENT):
            source = stripped[len(OFFICIAL_PACKAGE_ASSIGNMENT):]
            beginning = len(source) - len(source.lstrip())
            _value, end = json.JSONDecoder().raw_decode(source, beginning)
            if source[end:].strip() != ";":
                raise ValueError("SDK official registry assignment has trailing executable content")
            # Keep whitespace and object insertion order inside the assignment.
            # Only its declaration and terminating semicolon are discarded.
            raw = source[:end + source[end:].index(";")].encode("utf-8")
    else:
        raise ValueError("SDK official registry must be records or raw JSON bytes")
    records = json.loads(raw.decode("utf-8"), object_pairs_hook=_json_pairs)
    if not isinstance(records, dict) or not records:
        raise ValueError("SDK official registry must be a non-empty object")
    return raw, records


def _expanded_registry(records, root):
    """Resolve verified public sidecars for verification without rewriting JSON."""
    expanded, assets, containers = {}, {}, {}
    for package_id, record in records.items():
        if not isinstance(record, dict):
            raise ValueError(f"Invalid SDK official package: {package_id}")
        if "containerRef" not in record:
            expanded[package_id] = record
            continue
        descriptor = official_container_descriptor(record["containerRef"])
        if "container" in record:
            raise ValueError("SDK official package declares inline and external containers")
        candidates = [root / descriptor["path"], root / "dist" / descriptor["path"]]
        path = next((candidate for candidate in candidates if candidate.is_file()), None)
        if path is None or path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError(f"Missing SDK official container: {descriptor['path']}")
        data = path.read_bytes()
        actual = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        expected = {key: descriptor[key] for key in ("bytes", "sha256")}
        if actual != expected:
            raise ValueError(f"SDK official container hash/length mismatch: {descriptor['path']}")
        relative = path.relative_to(root).as_posix()
        assets[relative] = actual
        containers[descriptor["path"]] = data
        expanded[package_id] = {key: value for key, value in record.items() if key != "containerRef"}
        expanded[package_id]["container"] = base64.b64encode(data).decode("ascii")
    return expanded, assets, containers


def _signed_owner_records(root, apps):
    paths = set(FACULTY_INPUT_PATHS)
    for inputs in apps.values():
        paths.update(inputs["sourcePaths"])
    return {relative: _record(_safe_path(root, relative)) for relative in sorted(paths)}


def _verify_signed_sources(root, records):
    expanded, assets, containers = _expanded_registry(records, root)
    evidence = verify_official_package_records(expanded, _load_ring0_roots(root))
    apps = collect_official_app_inputs(root)
    faculty = {package_id: record for package_id, record in expanded.items()
               if "naviFaculty" in record["envelope"]["manifest"]}
    if set(expanded) != set(apps) | set(faculty):
        raise ValueError("SDK official registry does not match current app owners")
    for package_id, inputs in apps.items():
        if package_id not in expanded or expanded[package_id]["envelope"]["manifest"] != inputs["manifest"]:
            raise ValueError(f"SDK signed app source/manifest changed: {package_id}; supply an authorized replacement package")
    expected = _expected_faculty_revision_projection(root, None)
    if _faculty_revision_projection(faculty) != expected:
        raise ValueError("SDK signed Faculty source changed; supply an authorized replacement package")
    return _signed_owner_records(root, apps), assets, evidence, containers


def _verify_tools(tools):
    if sys.version_info < (3, 12):
        raise ValueError("SDK rebuilding requires Python 3.12 or later")
    if not isinstance(tools, dict) or tools.get("minifier") != "rjsmin":
        raise ValueError("SDK rebuilding requires the recorded rjsmin backend")
    packages = tools.get("packages")
    if not isinstance(packages, dict) or set(packages) != set(REQUIRED_TOOL_PINS) | set(COMPRESSION_TOOLS):
        raise ValueError("SDK tool records are incomplete")
    actual = sdk_tool_versions()
    if tools.get("python") != actual["python"]:
        raise ValueError(f"SDK Python version mismatch: requires {tools.get('python')!r}, running {actual['python']}")
    # Python's gzip backend links to zlib outside the pip dependency lock. Its
    # compiled and loaded library versions both matter to reproducible bytes.
    # LZMA exposes no library-version API; record its stdlib backend explicitly
    # rather than inventing a version or imposing a platform-specific file hash.
    if tools.get("nativeCompression") != actual["nativeCompression"]:
        raise ValueError("SDK native compression environment mismatch; use the recorded Python and zlib environment")
    for package, pin in REQUIRED_TOOL_PINS.items():
        if packages.get(package) != pin:
            raise ValueError(f"Unsupported SDK tool pin: {package}")
    for package, version in packages.items():
        if actual["packages"].get(package) != version:
            raise ValueError(f"SDK tool version mismatch: {package}; install requirements-sdk.txt explicitly")
    return actual


def _runtime_configuration(root, target, runtime_manifest):
    """Retain every accepted JavaScript/compression option instead of defaults."""
    if runtime_manifest is None:
        return None  # Legacy isolated fixtures do not contain a full runtime.
    if not isinstance(runtime_manifest, dict) or runtime_manifest.get("target") != target:
        raise ValueError("SDK runtime configuration target differs from its profile")
    name = runtime_manifest.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", name):
        raise ValueError("SDK runtime name must be one safe filename basename")
    entries = runtime_manifest.get("entries")
    if (not isinstance(entries, list) or not entries or any(not isinstance(entry, str) for entry in entries)
            or len(entries) != len(set(entries)) or entries[0] != SDK_PRIMARY_ENTRIES[target]):
        raise ValueError("SDK runtime entries must retain the canonical Engine primary entry")
    for entry in entries:
        path = _safe_path(root, entry)
        if path.suffix not in {".js", ".mjs"} or not path.is_file():
            raise ValueError(f"SDK runtime entry is missing or is not a JavaScript module: {entry}")
        if PurePosixPath(entry).parts[0] not in {"engine", "editor", "plauna", "agi", "webgpu-os", "tests"}:
            raise ValueError(f"SDK runtime entry is outside the public source roots: {entry}")
        if ".generated." in path.name and entry not in SDK_GENERATED_ENTRIES:
            raise ValueError(f"SDK runtime generated entry is unsupported: {entry}")
    for flag in ("obfuscate", "encrypt", "integrity_wrapper", "embed_source_tree", "domain_lock"):
        if runtime_manifest.get(flag):
            raise ValueError(f"SDK runtime configuration cannot replay wrapped or embedded source: {flag}")
    if runtime_manifest.get("zstd_dict_bytes") or runtime_manifest.get("dcz_dictionary_sha256"):
        raise ValueError("SDK runtime configuration cannot replay dictionary compression")
    defaults = {"production": False, "eager": target == "platform", "ns_ordered": False,
                "release": False, "extreme": False, "include_editor": target == "platform",
                "include_agi": target == "platform", "include_plauna": target == "platform",
                "include_webgpu_os": target == "platform"}
    flags = {flag: runtime_manifest.get(flag, default) for flag, default in defaults.items()}
    if any(type(value) is not bool for value in flags.values()):
        raise ValueError("SDK runtime build options must be boolean")
    if flags["extreme"] and not flags["release"]:
        raise ValueError("SDK extreme compression requires release compression")
    if target == "engine":
        if any(flags[flag] for flag in ("include_editor", "include_agi", "include_webgpu_os")):
            raise ValueError("Engine SDK runtime supports optional Plauna UI; other subsystems require Platform SDK")
        if flags["include_plauna"] != ("plauna/index.js" in entries):
            raise ValueError("Engine SDK Plauna runtime requires its canonical public entry point")
    if target == "platform" and not all(flags[flag] for flag in ("include_editor", "include_agi", "include_plauna", "include_webgpu_os")):
        raise ValueError("Platform SDK runtime must retain all platform subsystems")
    profile = runtime_manifest.get("site_profile", target)
    if not isinstance(profile, str) or not profile or "/" in profile or "\\" in profile:
        raise ValueError("SDK runtime site profile must be a canonical label")
    base = runtime_manifest.get("base_url_root", "webgpu-os/" if flags["include_webgpu_os"] else None)
    if base is not None:
        if not isinstance(base, str) or not base.endswith("/"):
            raise ValueError("SDK runtime URL base must be a canonical relative directory")
        _safe_path(root, base.removesuffix("/"))
    return {"name": name, "entries": list(entries), **flags, "site_profile": profile, "base_url_root": base}


def write_sdk_build_descriptor(stage, root, target, input_records, official_records=None, *, runtime_manifest=None):
    """Write complete rebuild evidence after canonical raw inputs are staged."""
    stage, root = Path(stage).resolve(), Path(root).resolve()
    if target not in {"engine", "platform"}:
        raise ValueError("SDK rebuilding supports engine and platform only")
    _validate_records(root, input_records)
    _validate_records(stage, input_records)
    runtime = _runtime_configuration(stage, target, runtime_manifest)
    tools = sdk_tool_versions()
    _verify_tools(tools)
    requirements = ("# Install explicitly before an offline SDK rebuild.\n"
                    f"# Requires Python {tools['python']} and the nativeCompression environment in sdk-build.json.\n") + "".join(
        f"{package}=={version}\n" for package, version in tools["packages"].items() if version is not None
    )
    (stage / "requirements-sdk.txt").write_text(requirements, encoding="utf-8", newline="\n")
    immutable = {relative: dict(record) for relative, record in input_records.items() if _immutable_path(relative)}
    immutable["requirements-sdk.txt"] = _record(stage / "requirements-sdk.txt")
    owners, evidence = {}, {}
    if target == "platform":
        if official_records is None:
            raise ValueError("Platform SDK requires its exact signed public registry")
        raw, records = _registry_bytes(official_records)
        owners, assets, evidence, _containers = _verify_signed_sources(stage, records)
        missing = set(owners) - set(input_records)
        if missing:
            raise ValueError(f"SDK signed-owner source is absent from the input graph: {sorted(missing)}")
        immutable.update(assets)
        (stage / SDK_REGISTRY_FILENAME).write_bytes(raw)
        immutable[SDK_REGISTRY_FILENAME] = _record(stage / SDK_REGISTRY_FILENAME)
    elif official_records is not None:
        raise ValueError("Engine SDK cannot declare a platform signed registry")
    input_digest = hashlib.sha256(json.dumps(input_records, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    descriptor = {"format": SDK_BUILD_FORMAT, "target": target, "pythonMinimum": [3, 12],
                  "tools": tools, "inputs": dict(sorted(input_records.items())), "inputSha256": input_digest,
                  "immutable": dict(sorted(immutable.items())), "signedOwners": owners,
                  "officialRegistry": SDK_REGISTRY_FILENAME if target == "platform" else None,
                  "officialEvidence": evidence, "runtime": runtime}
    (stage / SDK_BUILD_FILENAME).write_text(json.dumps(descriptor, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(f"[bundle][sdk-rebuild] recorded {len(input_records)} raw inputs, {len(immutable)} immutable inputs, {len(owners)} signed-owner inputs")
    return descriptor


def prepare_sdk_rebuild(root, target, *, supplied_registry=None):
    """Validate an extracted SDK without signing, downloading, or compiling WASM."""
    root = Path(root).resolve()
    descriptor = json.loads((root / SDK_BUILD_FILENAME).read_text(encoding="utf-8"))
    if (not isinstance(descriptor, dict) or descriptor.get("format") != SDK_BUILD_FORMAT
            or target not in {"engine", "platform"} or descriptor.get("target") != target
            or descriptor.get("pythonMinimum") != [3, 12]):
        raise ValueError("Unsupported SDK rebuild descriptor or target")
    if supplied_registry is not None and target != "platform":
        raise ValueError("A replacement signed registry requires the Platform SDK")
    _verify_tools(descriptor.get("tools"))
    inputs, immutable = descriptor.get("inputs"), descriptor.get("immutable")
    # Module sources may be edited. Presence, path safety and immutable native/tool
    # integrity remain mandatory; an updated kernel requires a separate native build.
    _validate_records(root, inputs, compare=False)
    input_digest = hashlib.sha256(json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if descriptor.get("inputSha256") != input_digest:
        raise ValueError("SDK original input identity drifted")
    _validate_records(root, immutable)
    runtime = descriptor.get("runtime")
    if runtime is not None:
        validated = _runtime_configuration(root, target, {"target": target, **runtime})
        if runtime != validated:
            raise ValueError("SDK recorded runtime configuration is not canonical")
    required_immutable = {relative for relative in inputs if _immutable_path(relative)} | {"requirements-sdk.txt"}
    if not required_immutable.issubset(immutable) or any(immutable[relative] != inputs[relative] for relative in required_immutable & set(inputs)):
        raise ValueError("SDK immutable inventory does not cover its native and build tools")
    verify_compute_artifacts(root, check_source=True)
    preamble, containers = None, {}
    if target == "platform":
        if descriptor.get("officialRegistry") != SDK_REGISTRY_FILENAME or SDK_REGISTRY_FILENAME not in immutable:
            raise ValueError("Platform SDK has no immutable public registry")
        replacement = supplied_registry is not None
        raw, records = _registry_bytes(supplied_registry if replacement else (root / SDK_REGISTRY_FILENAME).read_bytes())
        owners, assets, evidence, containers = _verify_signed_sources(root, records)
        if not replacement and (owners != descriptor.get("signedOwners") or evidence != descriptor.get("officialEvidence")):
            raise ValueError("SDK signed-owner inputs changed; supply an authorized replacement package")
        if not replacement and any(immutable.get(path) != record for path, record in assets.items()):
            raise ValueError("SDK immutable inventory omits public package sidecars")
        preamble = OFFICIAL_PACKAGE_ASSIGNMENT + raw.decode("utf-8") + ";"
    elif descriptor.get("officialRegistry") is not None or descriptor.get("signedOwners"):
        raise ValueError("Engine SDK cannot declare a platform signed registry")
    # The caller also updates its imported HAS_ESBUILD display flag. This ensures
    # bundle assembly itself cannot opportunistically choose another backend.
    from . import builder
    builder.HAS_ESBUILD = False
    print(f"[bundle][sdk-rebuild] verified {target} inputs; native assets reused and rjsmin selected")
    return {"descriptor": descriptor, "official_preamble": preamble,
            "official_container_assets": containers, "runtime": runtime}
