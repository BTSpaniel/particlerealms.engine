# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.config — paths, engine version, release-target resolution, skip patterns."""

import re
import json
import os
import tempfile
from pathlib import Path


# ---- Config -----------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENTRY = "engine/EngineBootstrap.js"
DEFAULT_OUTPUT_DIR = ROOT / "tests" / "assets"
DEFAULT_NAME = "particle-engine"
DEFAULT_TARGETS_CONFIG = ROOT / "release_targets.json"
OPTIONAL_ENTRYPOINTS = {
    "agi": "agi/index.js",
    "plauna": "plauna/index.js",
    "webgpu-os": "webgpu-os/index.js",
}
RELEASE_TARGETS_FORMAT = "particle-release-targets/v1"
CYCLIC_BASELINE_FORMAT = "particle-cyclic-baseline/v1"


def atomic_write_json_file(path, value):
    """Publish generated JSON through a same-directory atomic replace."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def _read_engine_version():
    """Read ENGINE_VERSION from engine/version.js (canonical source)."""
    vf = ROOT / "engine" / "version.js"
    if vf.is_file():
        text = vf.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"ENGINE_VERSION\s*=\s*['\"]([^'\"]+)['\"]", text)
        if m:
            return m.group(1)
    return "0.0.0"

ENGINE_VERSION = _read_engine_version()

def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]

def load_release_targets(config_path):
    path = Path(config_path)
    if not path.is_absolute():
        path = ROOT / path
    if not path.is_file():
        return {"defaultTarget": None, "targets": {}}
    value = json.loads(path.read_text(encoding="utf-8", errors="strict"))
    if not isinstance(value, dict):
        raise ValueError("Release targets root must be an object")
    declared_format = value.get("format")
    if declared_format is not None and declared_format != RELEASE_TARGETS_FORMAT:
        raise ValueError(f"Unsupported release targets format: {declared_format!r}")
    if declared_format is not None and value.get("schema_version") != 1:
        raise ValueError("Unsupported release targets schema_version")
    targets = value.get("targets")
    if not isinstance(targets, dict):
        raise ValueError("Release targets must define a targets object")
    for target_id, target in targets.items():
        if not isinstance(target_id, str) or not target_id or not isinstance(target, dict):
            raise ValueError("Release target entries require object definitions")
        entries = _as_list(target.get("entry"))
        if not entries or any(not isinstance(entry, str) or not entry for entry in entries):
            raise ValueError(f"Release target {target_id!r} has invalid entry paths")
        if not isinstance(target.get("name"), str) or not target["name"]:
            raise ValueError(f"Release target {target_id!r} requires a name")
    default_target = value.get("defaultTarget")
    if default_target is not None and default_target not in targets:
        raise ValueError(f"Unknown default release target: {default_target!r}")
    return value


def load_cyclic_baseline(path):
    """Read legacy lists or the current explicit cyclic-baseline envelope."""
    value = json.loads(Path(path).read_text(encoding="utf-8", errors="strict"))
    if isinstance(value, list):
        cycles = value
    elif isinstance(value, dict):
        if value.get("format") != CYCLIC_BASELINE_FORMAT or value.get("schema_version") != 1:
            raise ValueError("Unsupported cyclic baseline format or schema_version")
        cycles = value.get("cycles")
    else:
        raise ValueError("Cyclic baseline must be a list or versioned object")
    if not isinstance(cycles, list):
        raise ValueError("Cyclic baseline cycles must be an array")
    for index, cycle in enumerate(cycles):
        if not isinstance(cycle, list) or len(cycle) < 2:
            raise ValueError(f"Cyclic baseline cycle {index} must contain at least two modules")
        if any(not isinstance(module_id, str) or not module_id for module_id in cycle):
            raise ValueError(f"Cyclic baseline cycle {index} has an invalid module ID")
    return cycles


def cyclic_baseline_envelope(cycles):
    """Return the current write shape for a validated cycle list."""
    normalized = [sorted(set(cycle)) for cycle in cycles]
    return {
        "format": CYCLIC_BASELINE_FORMAT,
        "schema_version": 1,
        "cycles": sorted(normalized),
    }

def dedupe_preserve_order(items):
    seen = set()
    out = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out

def resolve_bundle_configuration(args):
    targets_config = load_release_targets(args.targets_config)
    target_name = args.target or targets_config.get("defaultTarget")
    target = {}
    if target_name:
        target = (targets_config.get("targets") or {}).get(target_name)
        if target is None:
            known = ", ".join(sorted((targets_config.get("targets") or {}).keys())) or "none"
            raise ValueError(f"Unknown target '{target_name}'. Known targets: {known}")

    cli_entry_default = args.entry == [DEFAULT_ENTRY]
    entries = _as_list(target.get("entry")) if target and cli_entry_default else _as_list(args.entry)
    if not entries:
        entries = [DEFAULT_ENTRY]

    include_agi = bool(target.get("include_agi", False)) or args.include_agi
    include_plauna = bool(target.get("include_plauna", False)) or args.include_plauna
    include_webgpu_os = bool(target.get("include_webgpu_os", False)) or args.include_webgpu_os

    if include_agi:
        entries.append(OPTIONAL_ENTRYPOINTS["agi"])
    if include_plauna:
        entries.append(OPTIONAL_ENTRYPOINTS["plauna"])
    if include_webgpu_os:
        entries.append(OPTIONAL_ENTRYPOINTS["webgpu-os"])

    args.name = args.name if args.name != DEFAULT_NAME or not target else target.get("name", args.name)
    args.eager = bool(args.eager or target.get("eager", False))
    args.site_profile = args.site_profile or target.get("site_profile")
    if args.build_site is None:
        args.build_site = bool(target.get("build_site", True))
    else:
        args.build_site = bool(args.build_site)
    args.build_sdk = bool(args.build_sdk or target.get("build_sdk", False))
    args.include_editor = bool(args.include_editor or target.get("include_editor", False))
    args.include_agi = include_agi
    args.include_plauna = include_plauna
    args.include_webgpu_os = include_webgpu_os
    args.base_url_root = target.get("base_url_root") if target else None
    # webgpu-os modules need their import.meta.url anchored to the OS root so
    # runtime app/mod fetches resolve. Auto-enable whenever the OS is bundled.
    if include_webgpu_os and not args.base_url_root:
        args.base_url_root = "webgpu-os/"
    args.target = target_name
    return dedupe_preserve_order(entries), target

SKIP_PATTERNS = [
    "node_modules", "__pycache__", ".git",
    ".trust-keys",   # ring-0 PRIVATE keys — never bundle (public roots ship via roots.json)
    "tests/common/TestLogger.js",
    "tests/common/TestLoop.js",
    "tests/common/TestInput.js",
    "tests/common/TestPage.js",
]
